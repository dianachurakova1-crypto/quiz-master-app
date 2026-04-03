const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const users = new Map();
const quizzes = new Map();
const rooms = new Map();
const userHistories = new Map();

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', ({ username, email, password }, callback) => {
        let userExists = false;
        for (let [id, user] of users.entries()) {
            if (user.email === email) {
                userExists = true;
                break;
            }
        }
        
        if (userExists) {
            callback({ success: false, error: 'Пользователь с такой почтой уже существует' });
        } else {
            const userId = uuidv4();
            users.set(userId, { username, email, password });
            
            if (!userHistories.has(userId)) {
                userHistories.set(userId, { organized: [], participated: [], gameHistory: [] });
            }
            
            socket.userId = userId;
            socket.username = username;
            
            callback({ success: true, userId, username });
        }
    });

    socket.on('login', ({ email, password }, callback) => {
        let foundUser = null;
        let foundUserId = null;
        
        for (let [id, user] of users.entries()) {
            if (user.email === email && user.password === password) {
                foundUser = user;
                foundUserId = id;
                break;
            }
        }
        
        if (foundUser) {
            socket.userId = foundUserId;
            socket.username = foundUser.username;
            
            callback({ success: true, userId: foundUserId, username: foundUser.username, email: foundUser.email });
        } else {
            callback({ success: false, error: 'Неверная почта или пароль' });
        }
    });

    socket.on('getUserHistory', ({ userId }, callback) => {
        const history = userHistories.get(userId) || { organized: [], participated: [], gameHistory: [] };
        callback({ success: true, history });
    });

    socket.on('createQuiz', ({ title, questions, userId }, callback) => {
        const quizId = uuidv4();
        const newQuiz = {
            id: quizId,
            title: title,
            questions: questions,
            createdBy: userId,
            createdAt: new Date().toISOString()
        };
        quizzes.set(quizId, newQuiz);
        
        const history = userHistories.get(userId);
        if (history) {
            if (!history.organized) history.organized = [];
            history.organized.push({
                quizId: quizId,
                title: title,
                date: new Date().toISOString(),
                questionsCount: questions.length
            });
            userHistories.set(userId, history);
        }
        
        callback({ success: true, quizId });
    });

    socket.on('startGame', ({ quizId, roomCode, userId }, callback) => {
        const quiz = quizzes.get(quizId);
        if (!quiz) {
            return callback({ success: false, error: 'Квиз не найден' });
        }
        
        if (rooms.has(roomCode)) {
            return callback({ success: false, error: 'Код занят' });
        }

        const gameRoom = {
            quiz: quiz,
            quizId: quizId,
            quizTitle: quiz.title,
            players: new Map(),
            currentQuestion: -1,
            status: 'waiting',
            ownerId: socket.id,
            ownerUserId: userId,
            ownerName: socket.username,
            roomCode: roomCode,
            results: null,
            timer: null,
            gameResults: null
        };
        
        rooms.set(roomCode, gameRoom);
        socket.join(roomCode);
        socket.emit('gameCreated', { roomCode, quizTitle: quiz.title });
        callback({ success: true });
    });

    socket.on('joinRoom', ({ roomCode, playerName, userId }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            return callback({ success: false, error: 'Комната не найдена' });
        }
        if (room.status !== 'waiting') {
            return callback({ success: false, error: 'Игра уже началась' });
        }
        
        let alreadyJoined = false;
        for (let [id, player] of room.players.entries()) {
            if (player.userId === userId) {
                alreadyJoined = true;
                break;
            }
        }
        
        if (alreadyJoined) {
            return callback({ success: false, error: 'Вы уже в этой комнате' });
        }
        
        room.players.set(socket.id, { 
            name: playerName, 
            score: 0, 
            userId: userId,
            answered: false 
        });
        socket.join(roomCode);
        
        io.to(roomCode).emit('playersUpdate', getPlayersList(room));
        
        callback({ success: true, quizTitle: room.quizTitle });
    });

    socket.on('startQuestion', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (!room || room.ownerId !== socket.id) return;
        
        room.currentQuestion++;
        if (room.currentQuestion >= room.quiz.questions.length) {
            room.status = 'results';
            const finalScores = getPlayersList(room);
            room.results = finalScores;
            room.gameResults = finalScores;
            
            const maxScore = Math.max(...finalScores.map(p => p.score));
            const winners = finalScores.filter(p => p.score === maxScore);
            const winnerNames = winners.map(w => w.name).join(', ');
            
            // Сохраняем историю для организатора
            const history = userHistories.get(room.ownerUserId);
            if (history) {
                if (!history.gameHistory) history.gameHistory = [];
                history.gameHistory.push({
                    quizId: room.quizId,
                    quizTitle: room.quizTitle,
                    date: new Date().toISOString(),
                    winner: winnerNames,
                    winnerScore: maxScore,
                    playersCount: room.players.size
                });
                userHistories.set(room.ownerUserId, history);
                console.log('Сохранена история для квиза:', room.quizTitle, 'ID:', room.quizId);
            }
            
            // Сохраняем участие для игроков
            for (let [playerId, player] of room.players.entries()) {
                if (player.userId) {
                    const playerHistory = userHistories.get(player.userId);
                    if (playerHistory) {
                        if (!playerHistory.participated) playerHistory.participated = [];
                        playerHistory.participated.push({
                            quizTitle: room.quizTitle,
                            date: new Date().toISOString(),
                            score: player.score,
                            totalQuestions: room.quiz.questions.length
                        });
                        userHistories.set(player.userId, playerHistory);
                    }
                }
            }
            
            io.to(roomCode).emit('gameFinished', finalScores);
            
            setTimeout(() => {
                if (rooms.has(roomCode)) {
                    if (room.timer) clearTimeout(room.timer);
                    rooms.delete(roomCode);
                    console.log('Комната удалена после окончания игры:', roomCode);
                }
            }, 5000);
            
            return;
        }
        
        room.status = 'question_active';
        
        for (let [id, player] of room.players.entries()) {
            player.answered = false;
        }
        
        const question = room.quiz.questions[room.currentQuestion];
        io.to(roomCode).emit('newQuestion', {
            questionText: question.text,
            image: question.image || null,
            options: question.options,
            type: question.type,
            points: question.points || 10,
            timeLimit: question.timeLimit || 20,
            questionIndex: room.currentQuestion + 1,
            totalQuestions: room.quiz.questions.length
        });
        
        const timer = setTimeout(() => {
            if (room.status === 'question_active') {
                room.status = 'answer_reveal';
                io.to(roomCode).emit('timeUp');
                io.to(roomCode).emit('showCorrectAnswers', {
                    correctAnswers: question.correct,
                    options: question.options,
                    type: question.type
                });
                socket.emit('enableNextButton');
            }
        }, (question.timeLimit || 20) * 1000);
        
        if (room.timer) clearTimeout(room.timer);
        room.timer = timer;
    });

    socket.on('submitAnswer', ({ roomCode, answers }, callback) => {
        const room = rooms.get(roomCode);
        if (!room || room.status !== 'question_active') {
            if (callback) callback({ success: false, error: 'Время вышло!' });
            return;
        }
        
        const player = room.players.get(socket.id);
        if (!player || player.answered) {
            if (callback) callback({ success: false, error: 'Вы уже ответили!' });
            return;
        }
        
        const currentQ = room.quiz.questions[room.currentQuestion];
        let isCorrect = false;
        
        if (currentQ.type === 'single') {
            isCorrect = (answers[0] === currentQ.correct);
        } else {
            const sortedAnswers = [...answers].sort();
            const sortedCorrect = [...currentQ.correct].sort();
            isCorrect = JSON.stringify(sortedAnswers) === JSON.stringify(sortedCorrect);
        }
        
        if (isCorrect) {
            const pointsEarned = currentQ.points || 10;
            player.score += pointsEarned;
        }
        
        player.answered = true;
        
        if (callback) {
            callback({ 
                success: true, 
                isCorrect: isCorrect,
                pointsEarned: isCorrect ? (currentQ.points || 10) : 0,
                correctAnswers: currentQ.correct,
                correctTexts: currentQ.options.filter((_, idx) => {
                    if (currentQ.type === 'single') return idx === currentQ.correct;
                    return currentQ.correct.includes(idx);
                })
            });
        }
        
        io.to(roomCode).emit('playersUpdate', getPlayersList(room));
    });

    socket.on('nextQuestion', ({ roomCode }) => {
        const room = rooms.get(roomCode);
        if (room && room.ownerId === socket.id && room.status === 'answer_reveal') {
            if (room.timer) clearTimeout(room.timer);
            room.status = 'waiting_for_next';
            io.to(roomCode).emit('resetForNext');
            socket.emit('requestStartQuestion');
        }
    });

    socket.on('getMyQuizzes', ({ userId }, callback) => {
        const myQuizzes = [];
        for (let [id, quiz] of quizzes.entries()) {
            if (quiz.createdBy === userId) {
                myQuizzes.push({
                    id: quiz.id,
                    title: quiz.title,
                    createdAt: quiz.createdAt,
                    questionsCount: quiz.questions.length
                });
            }
        }
        callback({ success: true, quizzes: myQuizzes });
    });

    socket.on('getQuizGameHistory', ({ quizId }, callback) => {
        const gameHistory = [];
        
        for (let [userId, history] of userHistories.entries()) {
            if (history.gameHistory && Array.isArray(history.gameHistory)) {
                for (let game of history.gameHistory) {
                    if (game.quizId === quizId) {
                        gameHistory.push({
                            quizTitle: game.quizTitle,
                            date: game.date,
                            winner: game.winner,
                            winnerScore: game.winnerScore,
                            playersCount: game.playersCount
                        });
                    }
                }
            }
        }
        
        gameHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        console.log('getQuizGameHistory для quizId:', quizId, 'найдено записей:', gameHistory.length);
        
        callback({ success: true, gameHistory: gameHistory });
    });
    
    socket.on('getGameHistory', ({ userId }, callback) => {
        const history = userHistories.get(userId);
        const gameHistory = history ? history.gameHistory || [] : [];
        callback({ success: true, gameHistory });
    });

    socket.on('getRoomPlayers', ({ roomCode }, callback) => {
        const room = rooms.get(roomCode);
        if (!room) {
            if (callback) callback({ success: false, error: 'Комната не найдена' });
            return;
        }
        
        const playersList = [];
        for (let [id, player] of room.players.entries()) {
            playersList.push({
                name: player.name,
                score: player.score,
                answered: player.answered
            });
        }
        
        if (callback) callback({ success: true, players: playersList.sort((a, b) => b.score - a.score) });
    });

    function getPlayersList(room) {
        const list = [];
        for (let [id, player] of room.players.entries()) {
            list.push({ 
                name: player.name, 
                score: player.score, 
                id: id,
                answered: player.answered 
            });
        }
        return list.sort((a, b) => b.score - a.score);
    }
    
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (let [code, room] of rooms.entries()) {
            if (room.players.has(socket.id)) {
                room.players.delete(socket.id);
                io.to(code).emit('playersUpdate', getPlayersList(room));
                
                if (room.players.size === 0 && room.status === 'waiting') {
                    if (room.timer) clearTimeout(room.timer);
                    rooms.delete(code);
                    console.log('Комната удалена (нет игроков):', code);
                }
            }
            if (room.ownerId === socket.id) {
                if (room.timer) clearTimeout(room.timer);
                rooms.delete(code);
                io.to(code).emit('hostDisconnected');
                console.log('Комната удалена (хост отключился):', code);
            }
        }
    });
});

server.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000');
});