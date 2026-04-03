const socket = io();
let currentUser = null;
let currentRoomCode = null;
let currentQuizId = null;
let questionsBank = [];
let activeQuestionTimeout = null;
let canAnswer = false;
let selectedAnswers = [];
let isOrganizer = false;
let currentTimerInterval = null;
let isGameFinished = false;
let currentQuestionData = null;
let allPlayersAnswered = false;
let timerEnded = false;
let pendingNextQuestion = false;
let reconnectAttempts = 0;

const registerScreen = document.getElementById('registerScreen');
const loginScreen = document.getElementById('loginScreen');
const mainScreen = document.getElementById('mainScreen');
const organizerScreen = document.getElementById('organizerScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const joinScreen = document.getElementById('joinScreen');
const gameScreen = document.getElementById('gameScreen');

document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', function() {
        const targetId = this.dataset.target;
        const input = document.getElementById(targetId);
        if (input.type === 'password') {
            input.type = 'text';
            this.textContent = '🙈';
        } else {
            input.type = 'password';
            this.textContent = '👁';
        }
    });
});

document.getElementById('goToLoginLink').onclick = () => {
    registerScreen.classList.add('hide');
    loginScreen.classList.remove('hide');
};

document.getElementById('goToRegisterLink').onclick = () => {
    loginScreen.classList.add('hide');
    registerScreen.classList.remove('hide');
};

function showFeedback(message, isSuccess) {
    const feedback = document.getElementById('feedback');
    feedback.textContent = message;
    feedback.className = `feedback-message ${isSuccess ? 'feedback-success' : 'feedback-error'}`;
    feedback.classList.remove('hide');
    setTimeout(() => {
        feedback.classList.add('hide');
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function returnToMainScreen() {
    isGameFinished = false;
    pendingNextQuestion = false;
    timerEnded = false;
    allPlayersAnswered = false;
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    gameScreen.classList.add('hide');
    mainScreen.classList.remove('hide');
    loadMainScreenData();
}

function returnToMainFromLobby() {
    lobbyScreen.classList.add('hide');
    mainScreen.classList.remove('hide');
    loadMainScreenData();
}

document.getElementById('registerBtn').onclick = () => {
    const nickname = document.getElementById('regNickname').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    
    if (!nickname || !email || !password) {
        showFeedback('Заполните все поля', false);
        return;
    }
    
    socket.emit('register', { username: nickname, email, password }, (response) => {
        if (response.success) {
            currentUser = { userId: response.userId, username: nickname, email: email };
            showFeedback('Добро пожаловать, ' + nickname + '!', true);
            registerScreen.classList.add('hide');
            mainScreen.classList.remove('hide');
            loadMainScreenData();
        } else {
            showFeedback(response.error, false);
        }
    });
};

document.getElementById('loginBtn').onclick = () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showFeedback('Заполните все поля', false);
        return;
    }
    
    socket.emit('login', { email, password }, (response) => {
        if (response.success) {
            currentUser = response;
            showFeedback('Добро пожаловать, ' + response.username + '!', true);
            loginScreen.classList.add('hide');
            mainScreen.classList.remove('hide');
            loadMainScreenData();
        } else {
            showFeedback(response.error, false);
        }
    });
};

function loadMainScreenData() {
    document.getElementById('mainUsername').innerHTML = '' + escapeHtml(currentUser.username);
    
    socket.emit('getMyQuizzes', { userId: currentUser.userId }, (response) => {
        if (response.success) {
            const container = document.getElementById('myQuizzesList');
            if (response.quizzes.length === 0) {
                container.innerHTML = '<div class="quiz-item">У вас пока нет созданных квизов</div>';
            } else {
                container.innerHTML = response.quizzes.map(quiz => `
                    <div class="quiz-item">
                        <div class="quiz-info">
                            <strong>${escapeHtml(quiz.title)}</strong><br>
                            Вопросов: ${quiz.questionsCount}<br>
                            Создан: ${new Date(quiz.createdAt).toLocaleString()}
                        </div>
                        <div class="quiz-actions">
                            <button class="btn-success round-btn" onclick="startQuizFromHistory('${quiz.id}', '${escapeHtml(quiz.title)}')" style="padding: 8px 16px;">Запустить</button>
                            <button class="btn-secondary round-btn" onclick="toggleGameHistory('${quiz.id}', '${escapeHtml(quiz.title)}', this)" style="padding: 8px 16px;">Проведённые</button>
                        </div>
                        <div id="history-${quiz.id}" class="game-history-dropdown" style="display: none; margin-top: 15px; width: 100%;">
                            <div class="history-header">История проведений "${escapeHtml(quiz.title)}"</div>
                            <div id="history-content-${quiz.id}" class="history-content">Загрузка...</div>
                        </div>
                    </div>
                `).join('');
            }
        }
    });
    
    socket.emit('getUserHistory', { userId: currentUser.userId }, (response) => {
        if (response.success) {
            const container = document.getElementById('participationHistory');
            const participated = response.history.participated || [];
            if (participated.length === 0) {
                container.innerHTML = '<div class="quiz-item">Вы ещё не участвовали в квизах</div>';
            } else {
                container.innerHTML = participated.map(p => `
                    <div class="quiz-item">
                        <div class="quiz-info">
                            <strong>${escapeHtml(p.quizTitle)}</strong><br>
                            Счёт: ${p.score} / ${p.totalQuestions * 10}<br>
                            Дата: ${new Date(p.date).toLocaleString()}
                        </div>
                    </div>
                `).join('');
            }
        }
    });
}

window.toggleGameHistory = (quizId, quizTitle, button) => {
    const historyDiv = document.getElementById(`history-${quizId}`);
    const historyContent = document.getElementById(`history-content-${quizId}`);
    
    if (historyDiv.style.display === 'none') {
        socket.emit('getQuizGameHistory', { quizId: quizId }, (response) => {
            if (response.success && response.gameHistory.length > 0) {
                historyContent.innerHTML = response.gameHistory.map(game => `
                    <div class="history-item">
                        <div class="history-date">${new Date(game.date).toLocaleString()}</div>
                        <div class="history-winner">Победитель: ${escapeHtml(game.winner)} (${game.winnerScore} очков)</div>
                        <div class="history-players">Участников: ${game.playersCount}</div>
                    </div>
                `).join('');
            } else {
                historyContent.innerHTML = '<div class="history-empty">Этот квиз ещё не проводился</div>';
            }
            historyDiv.style.display = 'block';
            button.innerHTML = 'Скрыть';
        });
    } else {
        historyDiv.style.display = 'none';
        button.innerHTML = 'Проведённые';
    }
};

document.getElementById('logoutFromMainBtn').onclick = () => {
    currentUser = null;
    currentRoomCode = null;
    currentQuizId = null;
    mainScreen.classList.add('hide');
    registerScreen.classList.remove('hide');
    loginScreen.classList.add('hide');
    document.getElementById('regNickname').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    showFeedback('Вы вышли из системы', true);
};

document.getElementById('createModeBtn').onclick = () => {
    questionsBank = [];
    mainScreen.classList.add('hide');
    organizerScreen.classList.remove('hide');
    renderQuestionForms();
};

document.getElementById('joinModeBtn').onclick = () => {
    mainScreen.classList.add('hide');
    joinScreen.classList.remove('hide');
};

document.getElementById('backToMainFromCreateBtn').onclick = () => {
    organizerScreen.classList.add('hide');
    mainScreen.classList.remove('hide');
    loadMainScreenData();
};

document.getElementById('backToMainFromJoinBtn').onclick = () => {
    joinScreen.classList.add('hide');
    mainScreen.classList.remove('hide');
    loadMainScreenData();
};

document.getElementById('exitLobbyBtn').onclick = () => {
    returnToMainFromLobby();
};

window.startQuizFromHistory = (quizId, quizTitle) => {
    currentQuizId = quizId;
    const roomCode = prompt('Введите код комнаты (3-10 символов)', 'QUIZ' + Math.floor(Math.random()*1000));
    if (roomCode && roomCode.trim()) {
        socket.emit('startGame', { quizId, roomCode: roomCode.trim(), userId: currentUser.userId }, (res) => {
            if (res.success) {
                currentRoomCode = roomCode.trim();
                isOrganizer = true;
                isGameFinished = false;
                pendingNextQuestion = false;
                timerEnded = false;
                allPlayersAnswered = false;
                mainScreen.classList.add('hide');
                lobbyScreen.classList.remove('hide');
                document.getElementById('lobbyQuizTitle').innerText = quizTitle;
                document.getElementById('roomCodeDisplay').innerText = roomCode;
                showFeedback('Лобби создано! Ожидайте игроков...', true);
                
                const interval = setInterval(() => {
                    if (lobbyScreen.classList.contains('hide')) {
                        clearInterval(interval);
                    } else {
                        socket.emit('getRoomPlayers', { roomCode: currentRoomCode }, (response) => {
                            if (response && response.success) {
                                const container = document.getElementById('playersList');
                                if (response.players.length === 0) {
                                    container.innerHTML = '<div class="leaderboard-item">Ожидание игроков...</div>';
                                } else {
                                    container.innerHTML = response.players.map(p => `<div class="leaderboard-item"><b>${escapeHtml(p.name)}</b> ${p.score} очков ${p.answered ? '✓' : '⌛'}</div>`).join('');
                                }
                            }
                        });
                    }
                }, 2000);
            } else {
                showFeedback(res.error, false);
            }
        });
    }
};

function renderQuestionForms() {
    const container = document.getElementById('questionsList');
    container.innerHTML = '';
    if (questionsBank.length === 0) {
        container.innerHTML = '<div class="card" style="color: #718096; text-align: center;">Нет вопросов. Нажми "+ Добавить вопрос"</div>';
    }
    questionsBank.forEach((q, idx) => {
        const div = document.createElement('div');
        div.className = 'question-card';
        
        let typeBadge = q.type === 'single' 
            ? '<span class="question-type-badge question-type-single">Одиночный выбор</span>'
            : '<span class="question-type-badge question-type-multiple">Множественный выбор</span>';
        
        div.innerHTML = `
            <div class="question-header">
                <div class="question-title">Вопрос ${idx+1}</div>
                ${typeBadge}
            </div>
            <input type="text" placeholder="Текст вопроса" value="${escapeHtml(q.text || '')}" data-idx="${idx}" data-field="text" class="question-text-input" style="width: 100%; margin-bottom: 12px;">
            <input type="text" placeholder="URL картинки (опционально)" value="${q.image || ''}" data-idx="${idx}" data-field="image" style="width: 100%; margin-bottom: 12px;">
            <select data-idx="${idx}" data-field="type" class="question-type-select" style="width: 100%; margin-bottom: 15px;">
                <option value="single" ${q.type === 'single' ? 'selected' : ''}>Одиночный выбор</option>
                <option value="multiple" ${q.type === 'multiple' ? 'selected' : ''}>Множественный выбор</option>
            </select>
            <div id="options-${idx}"></div>
            <label style="display: inline-flex; align-items: center; gap: 10px; margin-right: 20px;">
                Баллы: <input type="number" value="${q.points || 10}" data-idx="${idx}" data-field="points" style="width: 80px; margin: 0;">
            </label>
            <label style="display: inline-flex; align-items: center; gap: 10px;">
                Таймер (сек): <input type="number" value="${q.timeLimit || 20}" data-idx="${idx}" data-field="timeLimit" style="width: 80px; margin: 0;">
            </label>
            <div style="display: flex; align-items: center; gap: 10px; margin-top: 15px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
                <button class="delete-icon" data-remove="${idx}" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #e53e3e;">🗑</button>
                <span class="delete-text" data-remove="${idx}" style="color: #e53e3e; cursor: pointer; font-size: 14px;">Удалить вопрос</span>
            </div>
        `;
        container.appendChild(div);
        renderOptionsForQuestion(idx, q);
    });
    
    document.querySelectorAll('[data-field]').forEach(el => {
        el.addEventListener('change', (e) => {
            const idx = parseInt(el.dataset.idx);
            const field = el.dataset.field;
            if (questionsBank[idx]) {
                questionsBank[idx][field] = el.value;
            }
        });
    });
    
    document.querySelectorAll('.question-text-input').forEach(el => {
        el.addEventListener('input', (e) => {
            const idx = parseInt(el.dataset.idx);
            if (questionsBank[idx]) {
                questionsBank[idx].text = el.value;
            }
        });
    });
    
    document.querySelectorAll('.question-type-select').forEach(el => {
        el.addEventListener('change', (e) => {
            const idx = parseInt(el.dataset.idx);
            if (questionsBank[idx]) {
                questionsBank[idx].type = el.value;
                if (questionsBank[idx].type === 'single') {
                    if (typeof questionsBank[idx].correct === 'object') {
                        questionsBank[idx].correct = 0;
                    }
                } else {
                    if (typeof questionsBank[idx].correct === 'number') {
                        questionsBank[idx].correct = [];
                    }
                }
                renderOptionsForQuestion(idx, questionsBank[idx]);
                renderQuestionForms();
            }
        });
    });
    
    document.querySelectorAll('[data-remove]').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.remove);
            questionsBank.splice(idx, 1);
            renderQuestionForms();
            showFeedback('Вопрос удалён!', true);
        };
    });
}

function renderOptionsForQuestion(qIdx, question) {
    const container = document.getElementById(`options-${qIdx}`);
    if (!container) return;
    
    container.className = 'options-container';
    
    let html = `<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                    <p><strong>Варианты ответов:</strong></p>
                </div>`;
    
    let hasCorrectAnswer = false;
    
    if (question.type === 'single') {
        hasCorrectAnswer = (typeof question.correct === 'number' && question.correct >= 0);
    } else {
        hasCorrectAnswer = (Array.isArray(question.correct) && question.correct.length > 0);
    }
    
    if (!hasCorrectAnswer && question.options.length > 0) {
        html += '<div style="background: #fed7d7; color: #c53030; padding: 10px; border-radius: 12px; margin-bottom: 15px; font-size: 14px;">Выберите правильный ответ! Отметьте галочкой правильный вариант.</div>';
    }
    
    question.options.forEach((opt, optIdx) => {
        let isChecked = false;
        if (question.type === 'single') {
            isChecked = (question.correct === optIdx);
        } else {
            isChecked = Array.isArray(question.correct) && question.correct.includes(optIdx);
        }
        html += `
            <div class="option-item">
                <input type="text" value="${escapeHtml(opt)}" class="option-text-input" data-q="${qIdx}" data-optidx="${optIdx}">
                <input type="${question.type === 'single' ? 'radio' : 'checkbox'}" name="correct-${qIdx}" class="${question.type === 'single' ? 'custom-radio' : 'custom-checkbox'}" data-q="${qIdx}" data-optidx="${optIdx}" ${isChecked ? 'checked' : ''}>
                <button class="remove-option" data-q="${qIdx}" data-optidx="${optIdx}" title="Удалить вариант">🗑</button>
            </div>
        `;
    });
    html += `<button class="add-option-btn" data-q="${qIdx}">+ Добавить вариант</button>`;
    container.innerHTML = html;
    
    document.querySelectorAll(`.option-text-input[data-q="${qIdx}"]`).forEach(inp => {
        inp.onchange = (e) => {
            const q = parseInt(inp.dataset.q);
            const optIdx = parseInt(inp.dataset.optidx);
            if (questionsBank[q]) {
                questionsBank[q].options[optIdx] = inp.value;
            }
        };
    });
    
    document.querySelectorAll(`input[type="radio"][data-q="${qIdx}"], input[type="checkbox"][data-q="${qIdx}"]`).forEach(input => {
        input.onchange = (e) => {
            const q = parseInt(input.dataset.q);
            const optIdx = parseInt(input.dataset.optidx);
            if (!questionsBank[q]) return;
            
            if (questionsBank[q].type === 'single') {
                questionsBank[q].correct = optIdx;
                document.querySelectorAll(`input[type="radio"][data-q="${q}"]`).forEach(r => {
                    if (r !== input) r.checked = false;
                });
                showFeedback('Правильный ответ отмечен: "' + escapeHtml(questionsBank[q].options[optIdx]) + '"', true);
            } else {
                if (!Array.isArray(questionsBank[q].correct)) questionsBank[q].correct = [];
                if (input.checked) {
                    if (!questionsBank[q].correct.includes(optIdx)) {
                        questionsBank[q].correct.push(optIdx);
                        showFeedback('Вариант "' + escapeHtml(questionsBank[q].options[optIdx]) + '" отмечен как правильный!', true);
                    }
                } else {
                    questionsBank[q].correct = questionsBank[q].correct.filter(i => i !== optIdx);
                    showFeedback('Правильный ответ снят с варианта "' + escapeHtml(questionsBank[q].options[optIdx]) + '"', false);
                }
            }
            renderOptionsForQuestion(q, questionsBank[q]);
        };
    });
    
    document.querySelectorAll(`.remove-option[data-q="${qIdx}"]`).forEach(btn => {
        btn.onclick = () => {
            const q = parseInt(btn.dataset.q);
            const optIdx = parseInt(btn.dataset.optidx);
            if (questionsBank[q] && questionsBank[q].options.length > 1) {
                const deletedText = questionsBank[q].options[optIdx];
                questionsBank[q].options.splice(optIdx, 1);
                if (questionsBank[q].type === 'single') {
                    if (questionsBank[q].correct === optIdx) questionsBank[q].correct = 0;
                    else if (questionsBank[q].correct > optIdx) questionsBank[q].correct--;
                } else {
                    questionsBank[q].correct = questionsBank[q].correct.filter(i => i !== optIdx).map(i => i > optIdx ? i-1 : i);
                }
                renderOptionsForQuestion(q, questionsBank[q]);
                showFeedback('Вариант "' + escapeHtml(deletedText) + '" удалён!', true);
            } else {
                showFeedback('Должен быть хотя бы один вариант ответа', false);
            }
        };
    });
    
    document.querySelectorAll(`.add-option-btn[data-q="${qIdx}"]`).forEach(btn => {
        btn.onclick = () => {
            const q = parseInt(btn.dataset.q);
            if (questionsBank[q]) {
                questionsBank[q].options.push("Новый вариант");
                renderOptionsForQuestion(q, questionsBank[q]);
                showFeedback('Новый вариант добавлен!', true);
            }
        };
    });
}

document.getElementById('addQuestionBtn').onclick = () => {
    questionsBank.push({
        text: 'Новый вопрос',
        image: '',
        type: 'single',
        options: ['Вариант 1', 'Вариант 2'],
        correct: 0,
        points: 10,
        timeLimit: 20
    });
    renderQuestionForms();
    showFeedback('Новый вопрос добавлен!', true);
};

document.getElementById('saveQuizBtn').onclick = () => {
    const title = document.getElementById('quizTitle').value;
    if (questionsBank.length === 0) {
        showFeedback('Добавьте хотя бы один вопрос', false);
        return;
    }
    
    for (let i = 0; i < questionsBank.length; i++) {
        const q = questionsBank[i];
        if (!q.text || q.text.trim() === '') {
            showFeedback('Вопрос ' + (i+1) + ': введите текст вопроса', false);
            return;
        }
        if (!q.options || q.options.length < 2) {
            showFeedback('Вопрос ' + (i+1) + ': добавьте хотя бы 2 варианта ответа', false);
            return;
        }
        if (q.type === 'single' && typeof q.correct !== 'number') {
            showFeedback('Вопрос ' + (i+1) + ': отметьте правильный ответ (один)', false);
            return;
        }
        if (q.type === 'multiple' && (!Array.isArray(q.correct) || q.correct.length === 0)) {
            showFeedback('Вопрос ' + (i+1) + ': отметьте хотя бы один правильный ответ', false);
            return;
        }
    }
    
    socket.emit('createQuiz', { title, questions: questionsBank, userId: currentUser.userId }, (response) => {
        if (response.success) {
            currentQuizId = response.quizId;
            showFeedback('Квиз сохранён!', true);
            questionsBank = [];
            organizerScreen.classList.add('hide');
            mainScreen.classList.remove('hide');
            loadMainScreenData();
        } else {
            showFeedback(response.error || 'Ошибка при сохранении квиза', false);
        }
    });
};

document.getElementById('joinBtn').onclick = () => {
    const roomCode = document.getElementById('joinRoomCode').value.trim();
    const playerName = document.getElementById('playerName').value.trim();
    if (!roomCode || !playerName) {
        showFeedback('Заполните все поля', false);
        return;
    }
    
    // Очищаем старые данные перед подключением к новой игре
    isGameFinished = false;
    pendingNextQuestion = false;
    timerEnded = false;
    allPlayersAnswered = false;
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    
    socket.emit('joinRoom', { roomCode, playerName, userId: currentUser.userId }, (response) => {
        if (response.success) {
            currentRoomCode = roomCode;
            isOrganizer = false;
            joinScreen.classList.add('hide');
            gameScreen.classList.remove('hide');
            document.getElementById('gameTitle').innerText = response.quizTitle;
            document.getElementById('roleBadge').innerHTML = 'Участник';
            document.getElementById('organizerControls').classList.add('hide');
            document.getElementById('questionArea').innerHTML = '<div class="waiting-message">Ожидание начала игры...</div>';
            showFeedback('Вы подключились к игре! Ожидайте начала...', true);
        } else {
            showFeedback(response.error, false);
        }
    });
};

socket.on('playersUpdate', (players) => {
    const lobbyList = document.getElementById('playersList');
    if (lobbyList) {
        if (players.length === 0) {
            lobbyList.innerHTML = '<div class="leaderboard-item">Ожидание игроков...</div>';
        } else {
            lobbyList.innerHTML = players.map(p => `<div class="leaderboard-item"><b>${escapeHtml(p.name)}</b> ${p.score} очков ${p.answered ? '✓' : '⌛'}</div>`).join('');
            
            const allAnswered = players.length > 0 && players.every(p => p.answered === true);
            if (allAnswered && !allPlayersAnswered && isOrganizer && !timerEnded) {
                allPlayersAnswered = true;
                showFeedback('Все игроки ответили! Ожидайте окончания таймера.', true);
            }
        }
    }
    const gameList = document.getElementById('gamePlayersList');
    if (gameList && !isGameFinished) {
        if (players.length === 0) {
            gameList.innerHTML = '<div class="leaderboard-item">Нет игроков</div>';
        } else {
            gameList.innerHTML = players.map(p => `<div class="leaderboard-item"><b>${escapeHtml(p.name)}</b> ${p.score} очков</div>`).join('');
        }
    }
});

document.getElementById('startGameBtn')?.addEventListener('click', () => {
    allPlayersAnswered = false;
    timerEnded = false;
    pendingNextQuestion = false;
    socket.emit('startQuestion', { roomCode: currentRoomCode });
    lobbyScreen.classList.add('hide');
    gameScreen.classList.remove('hide');
    document.getElementById('roleBadge').innerHTML = 'Организатор';
    document.getElementById('organizerControls').classList.remove('hide');
    document.getElementById('questionArea').innerHTML = '<div class="waiting-message">Игра началась! Первый вопрос скоро появится...</div>';
    const nextBtn = document.getElementById('nextQuestionBtn');
    if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = '0.5';
    }
});

socket.on('newQuestion', (data) => {
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    
    allPlayersAnswered = false;
    timerEnded = false;
    pendingNextQuestion = false;
    currentQuestionData = data;
    
    if (!isOrganizer) {
        canAnswer = true;
        selectedAnswers = [];
    }
    
    const area = document.getElementById('questionArea');
    let optionsHtml = '';
    data.options.forEach((opt, idx) => {
        optionsHtml += `<div class="question-option" data-optidx="${idx}">${escapeHtml(opt)}</div>`;
    });
    
    let buttonsHtml = '';
    let timerHtml = '';
    
    if (!isOrganizer) {
        timerHtml = `<div class="timer" id="timerDisplay">${data.timeLimit}</div>
                     <button class="btn btn-success" id="submitAnswerBtn">Ответить</button>`;
    } else {
        timerHtml = `<div class="organizer-timer" id="organizerTimerDisplay">Таймер: ${data.timeLimit} сек</div>
                     <div class="waiting-message">Ожидание ответов игроков...</div>`;
        const nextBtn = document.getElementById('nextQuestionBtn');
        if (nextBtn) {
            nextBtn.disabled = true;
            nextBtn.style.opacity = '0.5';
        }
    }
    
    area.innerHTML = `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <span style="background: #2f855a; color: white; padding: 5px 12px; border-radius: 20px;">Вопрос ${data.questionIndex}/${data.totalQuestions}</span>
                <span style="font-weight: bold;">${data.points} баллов</span>
            </div>
            ${data.image ? `<img src="${data.image}" style="max-width:100%; border-radius:16px; margin-bottom: 15px;" onerror="this.style.display='none'">` : ''}
            <h3 style="margin-bottom: 20px;">${escapeHtml(data.questionText)}</h3>
            <div id="optionsContainer">${optionsHtml}</div>
            ${timerHtml}
            ${buttonsHtml}
        </div>
    `;
    
    if (!isOrganizer) {
        const optionsContainer = document.getElementById('optionsContainer');
        optionsContainer.querySelectorAll('.question-option').forEach(opt => {
            opt.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(opt.dataset.optidx);
                
                if (data.type === 'single') {
                    optionsContainer.querySelectorAll('.question-option').forEach(o => {
                        o.classList.remove('selected');
                    });
                    opt.classList.add('selected');
                    selectedAnswers = [idx];
                } else {
                    if (opt.classList.contains('selected')) {
                        opt.classList.remove('selected');
                        selectedAnswers = selectedAnswers.filter(i => i !== idx);
                    } else {
                        opt.classList.add('selected');
                        selectedAnswers.push(idx);
                    }
                }
            };
        });
        
        let timeLeft = data.timeLimit;
        const timerEl = document.getElementById('timerDisplay');
        currentTimerInterval = setInterval(() => {
            timeLeft--;
            if (timerEl) timerEl.innerText = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(currentTimerInterval);
                currentTimerInterval = null;
                const submitBtn = document.getElementById('submitAnswerBtn');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Время вышло!';
                }
                canAnswer = false;
            }
        }, 1000);
        
        const submitBtn = document.getElementById('submitAnswerBtn');
        submitBtn.onclick = () => {
            if (!canAnswer) {
                showFeedback('Время вышло или вы уже ответили!', false);
                return;
            }
            if (selectedAnswers.length === 0) {
                showFeedback('Выберите ответ!', false);
                return;
            }
            
            socket.emit('submitAnswer', { roomCode: currentRoomCode, answers: selectedAnswers }, (resp) => {
                if (resp.success) {
                    if (resp.isCorrect) {
                        showFeedback('Правильно! +' + resp.pointsEarned + ' баллов', true);
                    } else {
                        showFeedback('Неправильно! Правильный ответ: ' + resp.correctTexts.join(', '), false);
                    }
                    canAnswer = false;
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Отвечено';
                    if (currentTimerInterval) {
                        clearInterval(currentTimerInterval);
                        currentTimerInterval = null;
                    }
                } else {
                    showFeedback(resp.error, false);
                }
            });
        };
    } else {
        let timeLeft = data.timeLimit;
        const timerEl = document.getElementById('organizerTimerDisplay');
        currentTimerInterval = setInterval(() => {
            timeLeft--;
            if (timerEl) timerEl.innerText = 'Таймер: ' + timeLeft + ' сек';
            if (timeLeft <= 0) {
                clearInterval(currentTimerInterval);
                currentTimerInterval = null;
                timerEnded = true;
                const nextBtn = document.getElementById('nextQuestionBtn');
                if (nextBtn) {
                    nextBtn.disabled = false;
                    nextBtn.style.opacity = '1';
                }
                // Убираем автоматический диалог, только уведомление
                if (!pendingNextQuestion) {
                    showFeedback('Время вышло! Нажмите "Следующий вопрос" для продолжения.', true);
                }
            }
        }, 1000);
    }
});

socket.on('showCorrectAnswers', (data) => {
    const optionsContainer = document.querySelector('#optionsContainer');
    if (optionsContainer) {
        optionsContainer.querySelectorAll('.question-option').forEach((opt, idx) => {
            opt.classList.remove('correct-highlight', 'wrong-highlight');
            
            if (data.type === 'single') {
                if (idx === data.correctAnswers) {
                    opt.classList.add('correct-highlight');
                } else if (opt.classList.contains('selected')) {
                    opt.classList.add('wrong-highlight');
                }
            } else {
                if (data.correctAnswers.includes(idx)) {
                    opt.classList.add('correct-highlight');
                } else if (opt.classList.contains('selected') && !data.correctAnswers.includes(idx)) {
                    opt.classList.add('wrong-highlight');
                }
            }
        });
    }
});

socket.on('enableNextButton', () => {
    if (timerEnded) {
        const nextBtn = document.getElementById('nextQuestionBtn');
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.style.opacity = '1';
        }
    }
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
});

socket.on('gameFinished', (finalScores) => {
    isGameFinished = true;
    pendingNextQuestion = false;
    
    const maxScore = Math.max(...finalScores.map(p => p.score));
    const winners = finalScores.filter(p => p.score === maxScore);
    const winnerNames = winners.map(w => w.name).join(', ');
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    
    const gameList = document.getElementById('gamePlayersList');
    if (gameList) {
        gameList.innerHTML = finalScores.map(p => `
            <div class="leaderboard-item ${p.score === maxScore ? 'winner' : ''}">
                <b>${escapeHtml(p.name)}</b> ${p.score} очков
            </div>
        `).join('');
    }
    
    document.getElementById('questionArea').innerHTML = `
        <div class="winner-title">
            ПОБЕДИТЕЛЬ: ${escapeHtml(winnerNames)} (${maxScore} очков)
        </div>
        <div class="results-container">
            <h3>Финальные результаты:</h3>
            ${finalScores.map((p, i) => `<div class="leaderboard-item ${p.score === maxScore ? 'winner' : ''}"><b>${i+1}. ${escapeHtml(p.name)}</b> ${p.score} очков</div>`).join('')}
            <button class="btn btn-success" id="returnToMainBtn" style="margin-top: 20px;">На главную</button>
        </div>
    `;
    
    document.getElementById('organizerControls').classList.add('hide');
    
    const returnBtn = document.getElementById('returnToMainBtn');
    if (returnBtn) {
        returnBtn.onclick = () => {
            returnToMainScreen();
        };
    }
    
    if (isOrganizer) {
        loadMainScreenData();
    }
});

socket.on('hostDisconnected', () => {
    showFeedback('Организатор покинул игру', false);
    setTimeout(() => {
        returnToMainScreen();
    }, 2000);
});

document.getElementById('nextQuestionBtn')?.addEventListener('click', () => {
    if (pendingNextQuestion) return;
    
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
    
    // Только один диалог при нажатии кнопки
    const showNext = confirm('Перейти к следующему вопросу?');
    if (showNext) {
        socket.emit('nextQuestion', { roomCode: currentRoomCode });
        const btn = document.getElementById('nextQuestionBtn');
        btn.disabled = true;
        btn.style.opacity = '0.5';
        allPlayersAnswered = false;
        timerEnded = false;
    }
});

socket.on('requestStartQuestion', () => {
    if (pendingNextQuestion) return;
    
    // Убираем диалог - просто показываем следующий вопрос без подтверждения
    socket.emit('startQuestion', { roomCode: currentRoomCode });
    const nextBtn = document.getElementById('nextQuestionBtn');
    if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = '0.5';
    }
    allPlayersAnswered = false;
    timerEnded = false;
});

socket.on('resetForNext', () => {
    document.getElementById('questionArea').innerHTML = `
        <div class="waiting-message">
            Подготовка следующего вопроса...
            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" id="exitToMainFromWaitBtn">На главную</button>
            </div>
        </div>
    `;
    const exitBtn = document.getElementById('exitToMainFromWaitBtn');
    if (exitBtn) {
        exitBtn.onclick = () => {
            returnToMainScreen();
        };
    }
});

socket.on('timeUp', () => {
    if (isOrganizer && !pendingNextQuestion) {
        showFeedback('Время вышло! Нажмите "Следующий вопрос" для продолжения.', true);
        const nextBtn = document.getElementById('nextQuestionBtn');
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.style.opacity = '1';
        }
        timerEnded = true;
    }
    if (currentTimerInterval) {
        clearInterval(currentTimerInterval);
        currentTimerInterval = null;
    }
});

socket.on('gameCreated', (data) => {
    console.log('Игра создана:', data);
});

// Обработка переподключения
socket.on('disconnect', () => {
    console.log('Соединение потеряно');
    reconnectAttempts++;
    if (reconnectAttempts > 3) {
        showFeedback('Соединение потеряно. Возврат на главную...', false);
        setTimeout(() => {
            returnToMainScreen();
        }, 2000);
    }
});

socket.on('connect', () => {
    console.log('Соединение восстановлено');
    reconnectAttempts = 0;
});