let ws = null;
let currentUser = {
    id: null,
    username: null
};

let users = new Map();
let activeChats = new Map();
let currentChat = 'general';

// ===== ПЕРЕМЕННЫЕ ДЛЯ ЗВОНКОВ =====
let peerConnection = null;
let localStream = null;
let currentCall = {
    partnerId: null,
    partnerName: null,
    callId: null,
    status: 'idle' // idle, calling, ringing, in_call, ending
};
const servers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ]
};

// ===== ДОБАВЛЕНО: Переменные для групповых звонков =====
let isMicMuted = false;
let groupCall = {
    isActive: false,
    callId: null,
    participants: new Map(), // userId -> peerConnection
    isCreator: false,
    creatorName: null
};

// ===== ФУНКЦИЯ ДЛЯ ПЕРЕКЛЮЧЕНИЯ МИКРОФОНА =====
function toggleMicrophone() {
    if (!localStream) {
        console.log('Локальный поток не найден.');
        return;
    }
    
    const audioTracks = localStream.getAudioTracks();
    
    if (audioTracks.length === 0) {
        console.log('Аудиодорожки не найдены.');
        return;
    }
    
    isMicMuted = !isMicMuted;
    audioTracks.forEach(track => {
        track.enabled = !isMicMuted; // false = микрофон выключен
    });
    
    const micBtn = document.getElementById('toggleMicBtn');
    if (micBtn) {
        micBtn.textContent = isMicMuted ? '🎤 Включить микрофон' : '🎤 Выключить микрофон';
        micBtn.style.background = isMicMuted ? '#757575' : '#2196F3';
        console.log(`Микрофон ${isMicMuted ? 'выключен' : 'включен'}.`);
    }
    
    updateCallStatus(isMicMuted ? 'Микрофон выключен' : 'Микрофон включен');
}

// ===== ДОБАВЛЕНО: ФУНКЦИИ ДЛЯ ГРУППОВЫХ ЗВОНКОВ =====

// Создание группового звонка
function startGroupCall() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу.');
        return;
    }
    
    if (currentCall.status !== 'idle') {
        alert('Уже есть активный звонок');
        return;
    }
    
    const callId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Запрашиваем доступ к микрофону
    navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }, 
        video: false 
    })
    .then(stream => {
        localStream = stream;
        
        // Инициализируем групповой звонок
        groupCall = {
            isActive: true,
            callId: callId,
            participants: new Map(),
            isCreator: true,
            creatorName: currentUser.username
        };
        
        // Отправляем уведомление о создании звонка
        ws.send(JSON.stringify({
            type: 'group_call_start',
            callId: callId
        }));
        
        // Показываем интерфейс группового звонка
        showGroupCallInterface();
        updateGroupCallStatus(`Создан групповой звонок. Ожидание участников...`);
        
        // Добавляем кнопку микрофона
        const micBtn = document.getElementById('toggleMicBtn');
        if (micBtn) {
            micBtn.textContent = '🎤 Выключить микрофон';
            micBtn.style.background = '#2196F3';
            micBtn.style.display = 'inline-block';
        }
        
        console.log(`Создан групповой звонок: ${callId}`);
    })
    .catch(error => {
        console.error('Ошибка при создании группового звонка:', error);
        if (error.name === 'NotAllowedError') {
            alert('Доступ к микрофону запрещен. Разрешите доступ к микрофону в настройках браузера.');
        }
    });
}

// Присоединение к групповому звонку
function joinGroupCall(callId, creatorName) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу.');
        return;
    }
    
    if (currentCall.status !== 'idle') {
        alert('Уже есть активный звонок');
        return;
    }
    
    // Запрашиваем доступ к микрофону
    navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }, 
        video: false 
    })
    .then(stream => {
        localStream = stream;
        
        // Инициализируем групповой звонок как участник
        groupCall = {
            isActive: true,
            callId: callId,
            participants: new Map(),
            isCreator: false,
            creatorName: creatorName
        };
        
        // Отправляем запрос на присоединение
        ws.send(JSON.stringify({
            type: 'group_call_join',
            callId: callId
        }));
        
        // Показываем интерфейс группового звонка
        showGroupCallInterface();
        updateGroupCallStatus(`Подключение к групповому звонку...`);
        
        // Добавляем кнопку микрофона
        const micBtn = document.getElementById('toggleMicBtn');
        if (micBtn) {
            micBtn.textContent = '🎤 Выключить микрофон';
            micBtn.style.background = '#2196F3';
            micBtn.style.display = 'inline-block';
        }
        
        console.log(`Присоединение к групповому звонку: ${callId}`);
    })
    .catch(error => {
        console.error('Ошибка при присоединении к групповому звонку:', error);
        if (error.name === 'NotAllowedError') {
            alert('Доступ к микрофону запрещен. Разрешите доступ к микрофону в настройках браузера.');
        }
    });
}

// Завершение группового звонка
function endGroupCall() {
    if (!groupCall.isActive) return;
    
    if (groupCall.isCreator) {
        // Если мы создатель, завершаем звонок для всех
        ws.send(JSON.stringify({
            type: 'group_call_end',
            callId: groupCall.callId
        }));
    } else {
        // Если мы участник, просто выходим
        ws.send(JSON.stringify({
            type: 'group_call_leave',
            callId: groupCall.callId
        }));
    }
    
    // Закрываем все соединения
    groupCall.participants.forEach((peer, userId) => {
        if (peer) peer.close();
    });
    
    // Останавливаем локальный поток
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Сбрасываем состояние
    groupCall = {
        isActive: false,
        callId: null,
        participants: new Map(),
        isCreator: false,
        creatorName: null
    };
    
    isMicMuted = false;
    
    // Скрываем интерфейс
    hideGroupCallInterface();
    console.log('Групповой звонок завершен');
}

// Интерфейс для групповых звонков
function showGroupCallInterface() {
    const container = document.getElementById('groupCallContainer');
    const title = document.getElementById('groupCallTitle');
    const status = document.getElementById('groupCallStatus');
    const participantsList = document.getElementById('groupCallParticipants');
    const endBtn = document.getElementById('endGroupCallBtn');
    
    if (container && title && status) {
        container.style.display = 'block';
        title.textContent = groupCall.isCreator ? '🎙️ Ваш групповой звонок' : `🎙️ Групповой звонок от ${groupCall.creatorName}`;
        status.textContent = 'Подключение...';
        
        if (participantsList) {
            participantsList.innerHTML = '<li>Загрузка участников...</li>';
        }
        
        if (endBtn) {
            endBtn.textContent = groupCall.isCreator ? 'Завершить для всех' : 'Покинуть звонок';
        }
    }
    
    // Скрываем кнопку приватного звонка
    const callContainer = document.getElementById('callContainer');
    if (callContainer) {
        callContainer.style.display = 'none';
    }
}

function updateGroupCallStatus(text) {
    const statusEl = document.getElementById('groupCallStatus');
    if (statusEl) {
        statusEl.textContent = text;
    }
}

function updateGroupCallParticipants(participants) {
    const participantsList = document.getElementById('groupCallParticipants');
    if (!participantsList) return;
    
    participantsList.innerHTML = '';
    
    // Добавляем себя
    const selfItem = document.createElement('li');
    selfItem.innerHTML = `<strong>${currentUser.username} (Вы)</strong> ${isMicMuted ? '🔇' : '🎤'}`;
    participantsList.appendChild(selfItem);
    
    // Добавляем других участников
    participants.forEach(participant => {
        if (participant !== currentUser.username) {
            const item = document.createElement('li');
            item.textContent = participant;
            participantsList.appendChild(item);
        }
    });
}

function hideGroupCallInterface() {
    const container = document.getElementById('groupCallContainer');
    if (container) {
        container.style.display = 'none';
    }
    
    // Скрываем кнопку микрофона
    const micBtn = document.getElementById('toggleMicBtn');
    if (micBtn) {
        micBtn.style.display = 'none';
    }
}

// ===== ОСНОВНОЕ ПОДКЛЮЧЕНИЕ =====
function connect() {
    const usernameInput = document.getElementById('usernameInput');
    if (!usernameInput) {
        console.error('Не найден элемент usernameInput');
        return;
    }
    
    const username = usernameInput.value.trim();
    
    if (!username) {
        alert('Пожалуйста, введите имя пользователя');
        return;
    }
    
    updateStatus('⏳ Подключение...', 'connecting');
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    console.log('Подключаемся к:', wsUrl);
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket соединение установлено');
        updateStatus('✅ Подключено', 'connected');
        
        currentUser.username = username;
        
        ws.send(JSON.stringify({
            type: 'set_username',
            username: username
        }));
        
        const loginScreen = document.getElementById('loginScreen');
        if (loginScreen) {
            loginScreen.style.display = 'none';
        }
        
        const currentUsernameEl = document.getElementById('currentUsername');
        if (currentUsernameEl) {
            currentUsernameEl.textContent = username;
        }
        
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'get_users'
                }));
            }
        }, 500);
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Получено:', data.type);
            
            switch (data.type) {
                case 'connected':
                    currentUser.id = data.userId;
                    console.log('User ID установлен:', currentUser.id);
                    break;
                    
                case 'user_list':
                    updateUsersList(data.users);
                    break;
                    
                case 'general_history':
                    loadGeneralHistory(data.messages);
                    break;
                    
                case 'general_message':
                    displayGeneralMessage(data.data);
                    break;
                    
                case 'private_room_created':
                    createPrivateChatTab(data.roomId, data.partner, data.partnerId);
                    break;
                    
                case 'private_message':
                    displayPrivateMessage(data.data);
                    break;
                    
                case 'private_history':
                    loadPrivateHistory(data.roomId, data.messages);
                    break;
                    
                // ===== ОБРАБОТКА ПРИВАТНЫХ ЗВОНКОВ =====
                case 'call_offer':
                    handleIncomingCall(data.offer, data.callerId, data.callerName, data.callId);
                    break;
                    
                case 'call_answer':
                    handleCallAnswer(data.answer, data.callId);
                    break;
                    
                case 'ice_candidate':
                    handleNewICECandidate(data.candidate, data.callId);
                    break;
                    
                case 'call_ended':
                    handleCallEnded(data.callId);
                    break;
                    
                case 'call_rejected':
                    handleCallRejected(data.callId);
                    break;
                    
                case 'call_error':
                    alert('Ошибка звонка: ' + data.message);
                    resetCallState();
                    break;
                    
                // ===== ДОБАВЛЕНО: ОБРАБОТКА ГРУППОВЫХ ЗВОНКОВ =====
                case 'group_call_started':
                    // Уведомление о создании группового звонка
                    displayGroupCallNotification(data.callId, data.creatorName);
                    break;
                    
                case 'group_call_participants':
                    // Получение списка участников
                    if (groupCall.isActive && groupCall.callId === data.callId) {
                        updateGroupCallParticipants(data.participants);
                        updateGroupCallStatus(`Участников: ${data.participants.length}`);
                    }
                    break;
                    
                case 'group_call_user_joined':
                    // Новый участник присоединился
                    if (groupCall.isActive && groupCall.callId === data.callId) {
                        addGroupCallNotification(`${data.username} присоединился к звонку`);
                    }
                    break;
                    
                case 'group_call_user_left':
                    // Участник покинул звонк
                    if (groupCall.isActive && groupCall.callId === data.callId) {
                        addGroupCallNotification(`${data.username} покинул звонок`);
                    }
                    break;
                    
                case 'group_call_ended':
                    // Создатель завершил звонок
                    if (groupCall.isActive && groupCall.callId === data.callId) {
                        alert(`Групповой звонок завершен пользователем ${data.endedBy}`);
                        endGroupCall();
                    }
                    break;
                    
                case 'group_call_signal':
                    // Сигнал WebRTC от другого участника
                    if (groupCall.isActive && groupCall.callId === data.callId) {
                        handleGroupCallSignal(data.senderId, data.signal);
                    }
                    break;
                    
                case 'error':
                    console.error('Ошибка сервера:', data.message);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error, event.data);
        }
    };
    
    ws.onclose = (event) => {
        console.log('❌ WebSocket соединение закрыто');
        updateStatus('❌ Отключено', 'disconnected');
        showReconnectButton();
        
        // Завершаем групповой звонок при отключении
        if (groupCall.isActive) {
            endGroupCall();
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        updateStatus('❌ Ошибка подключения', 'error');
    };
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ГРУППОВЫХ ЗВОНКОВ =====

function displayGroupCallNotification(callId, creatorName) {
    // Показываем уведомление в общем чате
    const messagesContainer = document.getElementById('generalMessages');
    if (messagesContainer) {
        const notification = document.createElement('div');
        notification.className = 'system-message';
        notification.innerHTML = `
            <div>🎙️ <strong>${creatorName}</strong> начал групповой звонок!</div>
            <button onclick="joinGroupCall('${callId}', '${creatorName}')" 
                    style="margin-top: 10px; padding: 8px 15px; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer;">
                Присоединиться
            </button>
        `;
        messagesContainer.appendChild(notification);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function addGroupCallNotification(message) {
    const statusEl = document.getElementById('groupCallStatus');
    if (statusEl) {
        const oldText = statusEl.textContent;
        statusEl.textContent = `${message}. ${oldText}`;
    }
}

function handleGroupCallSignal(senderId, signal) {
    // Здесь должна быть логика обработки WebRTC сигналов для mesh-сети
    // Это сложная реализация, требующая создания отдельных peerConnection для каждого участника
    console.log('Получен групповой сигнал от:', senderId, signal);
}

// ===== ФУНКЦИИ ДЛЯ ПРИВАТНЫХ ЗВОНКОВ (остаются без изменений) =====
function startVoiceCall(targetUserId, targetUserName) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу.');
        return;
    }
    
    if (currentCall.status !== 'idle') {
        alert('Уже есть активный звонок');
        return;
    }
    
    console.log(`Запуск звонка пользователю: ${targetUserName}`);
    currentCall = {
        partnerId: targetUserId,
        partnerName: targetUserName,
        callId: generateCallId(),
        status: 'calling'
    };
    
    isMicMuted = false;
    
    showCallInterface(`Звонок ${targetUserName}...`, false);
    updateCallStatus('Набор номера...');
    
    navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }, 
        video: false 
    })
    .then(stream => {
        localStream = stream;
        createPeerConnection();
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        return peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false
        });
    })
    .then(offer => {
        return peerConnection.setLocalDescription(offer);
    })
    .then(() => {
        ws.send(JSON.stringify({
            type: 'call_offer',
            targetUserId: targetUserId,
            offer: peerConnection.localDescription,
            callId: currentCall.callId
        }));
        
        currentCall.status = 'ringing';
        updateCallStatus('Вызов... Ожидание ответа');
        
        const micBtn = document.getElementById('toggleMicBtn');
        if (micBtn) {
            micBtn.textContent = '🎤 Выключить микрофон';
            micBtn.style.background = '#2196F3';
            micBtn.style.display = 'inline-block';
        }
        
        setTimeout(() => {
            if (currentCall.status === 'ringing') {
                alert('Пользователь не ответил');
                endCall();
            }
        }, 60000);
    })
    .catch(error => {
        console.error('Ошибка при запуске звонка:', error);
        if (error.name === 'NotAllowedError') {
            alert('Доступ к микрофону запрещен. Разрешите доступ к микрофону в настройках браузера.');
        }
        resetCallState();
    });
}

function createPeerConnection() {
    try {
        peerConnection = new RTCPeerConnection(servers);
        
        peerConnection.ontrack = (event) => {
            console.log('Получен удаленный аудиопоток.');
            const remoteAudio = document.getElementById('remoteAudio');
            if (remoteAudio && event.streams[0]) {
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.play().catch(e => {
                    console.log('Автовоспроизведение заблокировано:', e);
                    showPlayAudioButton();
                });
            }
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && currentCall.partnerId) {
                ws.send(JSON.stringify({
                    type: 'ice_candidate',
                    targetUserId: currentCall.partnerId,
                    candidate: event.candidate,
                    callId: currentCall.callId
                }));
            }
        };
        
        peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE состояние:', peerConnection.iceConnectionState);
            updateCallStatus(`Состояние: ${peerConnection.iceConnectionState}`);
            
            if (peerConnection.iceConnectionState === 'disconnected' ||
                peerConnection.iceConnectionState === 'failed' ||
                peerConnection.iceConnectionState === 'closed') {
                console.log('Соединение прервано');
                if (currentCall.status === 'in_call') {
                    alert('Соединение прервано');
                    endCall();
                }
            }
            
            if (peerConnection.iceConnectionState === 'connected') {
                currentCall.status = 'in_call';
                updateCallStatus('Разговор идет...');
                hideCallAcceptRejectButtons();
            }
        };
        
        peerConnection.onsignalingstatechange = () => {
            console.log('Signaling состояние:', peerConnection.signalingState);
        };
        
    } catch (error) {
        console.error('Ошибка создания PeerConnection:', error);
        throw error;
    }
}

function handleIncomingCall(offer, callerId, callerName, callId) {
    console.log(`Входящий звонок от: ${callerName}`);
    
    if (currentCall.status !== 'idle' || groupCall.isActive) {
        ws.send(JSON.stringify({
            type: 'reject_call',
            callerId: callerId,
            callId: callId
        }));
        return;
    }
    
    currentCall = {
        partnerId: callerId,
        partnerName: callerName,
        callId: callId,
        status: 'ringing'
    };
    
    isMicMuted = false;
    window.incomingOffer = offer;
    
    showCallInterface(`Входящий звонок от ${callerName}`, true);
    updateCallStatus('Входящий вызов...');
    
    playRingtone();
    
    const micBtn = document.getElementById('toggleMicBtn');
    if (micBtn) {
        micBtn.style.display = 'none';
    }
    
    setTimeout(() => {
        if (currentCall.status === 'ringing') {
            rejectCall();
        }
    }, 45000);
}

function acceptCall() {
    if (!window.incomingOffer) return;
    
    stopRingtone();
    currentCall.status = 'in_call';
    updateCallStatus('Подключение...');
    
    navigator.mediaDevices.getUserMedia({ 
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }, 
        video: false 
    })
    .then(stream => {
        localStream = stream;
        createPeerConnection();
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        return peerConnection.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
    })
    .then(() => {
        return peerConnection.createAnswer();
    })
    .then(answer => {
        return peerConnection.setLocalDescription(answer);
    })
    .then(() => {
        ws.send(JSON.stringify({
            type: 'call_answer',
            callerId: currentCall.partnerId,
            answer: peerConnection.localDescription,
            callId: currentCall.callId
        }));
        
        updateCallStatus('Разговор идет...');
        hideCallAcceptRejectButtons();
        
        const micBtn = document.getElementById('toggleMicBtn');
        if (micBtn) {
            micBtn.textContent = '🎤 Выключить микрофон';
            micBtn.style.background = '#2196F3';
            micBtn.style.display = 'inline-block';
        }
        
        delete window.incomingOffer;
    })
    .catch(error => {
        console.error('Ошибка при принятии звонка:', error);
        alert('Ошибка при принятии звонка: ' + error.message);
        endCall();
    });
}

function handleCallAnswer(answer, callId) {
    if (!peerConnection || currentCall.callId !== callId) return;
    
    console.log('Получен answer');
    peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        .then(() => {
            console.log('Удаленное описание установлено');
            currentCall.status = 'in_call';
            updateCallStatus('Разговор идет...');
            hideCallAcceptRejectButtons();
        })
        .catch(error => {
            console.error('Ошибка установки удаленного описания:', error);
            endCall();
        });
}

function handleNewICECandidate(candidate, callId) {
    if (!peerConnection || currentCall.callId !== callId) return;
    
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .catch(error => {
            console.error('Ошибка добавления ICE кандидата:', error);
        });
}

function endCall() {
    if (currentCall.status === 'idle') return;
    
    console.log('Завершение звонка');
    
    if (currentCall.partnerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'end_call',
            targetUserId: currentCall.partnerId,
            callId: currentCall.callId
        }));
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    stopRingtone();
    resetCallState();
    hideCallInterface();
}

function rejectCall() {
    if (currentCall.status !== 'ringing') return;
    
    console.log('Отклонение звонка');
    
    if (currentCall.partnerId && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'reject_call',
            callerId: currentCall.partnerId,
            callId: currentCall.callId
        }));
    }
    
    stopRingtone();
    resetCallState();
    hideCallInterface();
}

function handleCallEnded(callId) {
    if (currentCall.callId !== callId) return;
    
    console.log('Собеседник завершил звонок');
    alert('Собеседник завершил звонок');
    endCall();
}

function handleCallRejected(callId) {
    if (currentCall.callId !== callId) return;
    
    console.log('Звонок отклонен');
    alert('Пользователь отклонил звонок');
    endCall();
}

function generateCallId() {
    return 'call_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function resetCallState() {
    currentCall = {
        partnerId: null,
        partnerName: null,
        callId: null,
        status: 'idle'
    };
    isMicMuted = false;
    window.incomingOffer = null;
}

function playRingtone() {
    const audio = document.getElementById('ringtone');
    if (audio) {
        audio.loop = true;
        audio.play().catch(e => console.log('Не удалось воспроизвести рингтон:', e));
    }
}

function stopRingtone() {
    const audio = document.getElementById('ringtone');
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
}

function updateCallStatus(text) {
    const statusEl = document.getElementById('callStatus');
    if (statusEl) {
        statusEl.textContent = text;
    }
}

function showCallInterface(title, showAccept = false) {
    const container = document.getElementById('callContainer');
    const titleEl = document.getElementById('callTitle');
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    const endBtn = document.getElementById('endCallBtn');
    
    if (container && titleEl) {
        titleEl.textContent = title;
        container.style.display = 'block';
        
        if (showAccept) {
            acceptBtn.style.display = 'inline-block';
            rejectBtn.style.display = 'inline-block';
            endBtn.style.display = 'none';
        } else {
            acceptBtn.style.display = 'none';
            rejectBtn.style.display = 'none';
            endBtn.style.display = 'inline-block';
        }
    }
}

function hideCallAcceptRejectButtons() {
    const acceptBtn = document.getElementById('acceptCallBtn');
    const rejectBtn = document.getElementById('rejectCallBtn');
    const endBtn = document.getElementById('endCallBtn');
    
    acceptBtn.style.display = 'none';
    rejectBtn.style.display = 'none';
    endBtn.style.display = 'inline-block';
}

function hideCallInterface() {
    const container = document.getElementById('callContainer');
    if (container) {
        container.style.display = 'none';
    }
    
    const micBtn = document.getElementById('toggleMicBtn');
    if (micBtn) {
        micBtn.style.display = 'none';
    }
}

function showPlayAudioButton() {
    const playBtn = document.getElementById('playAudioBtn');
    if (playBtn) {
        playBtn.style.display = 'inline-block';
    }
}

// ===== ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений) =====

function updateStatus(text, status) {
    const statusText = document.getElementById('statusText');
    const connectionDot = document.getElementById('connectionDot');
    
    if (statusText) statusText.textContent = text;
    if (connectionDot) {
        connectionDot.className = 'connection-dot';
        connectionDot.classList.add(status);
    }
    
    const loginStatusText = document.querySelector('#loginScreen .status-text');
    if (loginStatusText) loginStatusText.textContent = text;
}

function showReconnectButton() {
    const loginScreen = document.getElementById('loginScreen');
    if (!loginScreen) return;
    
    loginScreen.style.display = 'flex';
    
    const loginForm = loginScreen.querySelector('.login-form');
    if (!loginForm) return;
    
    const oldBtn = loginForm.querySelector('.reconnect-btn');
    if (oldBtn) oldBtn.remove();
    
    const reconnectBtn = document.createElement('button');
    reconnectBtn.className = 'btn reconnect-btn';
    reconnectBtn.textContent = '🔄 Переподключиться';
    reconnectBtn.onclick = () => location.reload();
    reconnectBtn.style.marginTop = '15px';
    reconnectBtn.style.background = '#ff9800';
    
    loginForm.appendChild(reconnectBtn);
}

function updateUsersList(usersList) {
    const usersListElement = document.getElementById('usersList');
    const userCountElement = document.getElementById('userCount');
    
    if (!usersListElement) return;
    
    usersListElement.innerHTML = '';
    users.clear();
    
    if (userCountElement) {
        userCountElement.textContent = `Пользователей онлайн: ${usersList.length}`;
    }
    
    const onlineCountElement = document.getElementById('onlineCount');
    if (onlineCountElement) {
        onlineCountElement.textContent = usersList.length;
    }
    
    usersList.forEach(user => {
        if (user.id === currentUser.id) return;
        
        users.set(user.id, user);
        
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.dataset.userId = user.id;
        
        const firstLetter = user.username.charAt(0).toUpperCase();
        
        userElement.innerHTML = `
            <div class="user-avatar">${firstLetter}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.username)}</div>
                <div class="user-status">
                    <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
                    ${user.online ? 'В сети' : 'Не в сети'}
                </div>
            </div>
            <button class="start-chat-btn" onclick="startPrivateChat('${user.id}')">
                💬 Чат
            </button>
            <button class="call-btn" onclick="startVoiceCall('${user.id}', '${escapeHtml(user.username)}')" 
                    style="margin-left: 5px; background: #4CAF50; color: white; border: none; padding: 8px 12px; border-radius: 20px; cursor: pointer;">
                📞
            </button>
        `;
        
        usersListElement.appendChild(userElement);
    });
}

function loadGeneralHistory(messages) {
    const messagesContainer = document.getElementById('generalMessages');
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '';
    messages.forEach(message => {
        const messageElement = createMessageElement(message, false);
        messagesContainer.appendChild(messageElement);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function displayGeneralMessage(messageData) {
    const messagesContainer = document.getElementById('generalMessages');
    if (!messagesContainer) return;
    
    const messageElement = createMessageElement(messageData, false);
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendGeneralMessage() {
    const input = document.getElementById('generalMessageInput');
    if (!input) return;
    
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: 'general_message',
        text: text
    }));
    
    input.value = '';
    input.focus();
}

function handleGeneralKeyPress(event) {
    if (event.key === 'Enter') sendGeneralMessage();
}

function startPrivateChat(targetUserId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу');
        return;
    }
    
    for (const [roomId, chat] of activeChats.entries()) {
        if (chat.partnerId === targetUserId) {
            switchChat(roomId);
            return;
        }
    }
    
    ws.send(JSON.stringify({
        type: 'start_private_chat',
        targetUserId: targetUserId
    }));
}

function createPrivateChatTab(roomId, partnerName, partnerId) {
    if (activeChats.has(roomId)) {
        switchChat(roomId);
        return;
    }
    
    const chatTabs = document.getElementById('chatTabs');
    if (!chatTabs) return;
    
    const tab = document.createElement('div');
    tab.className = 'chat-tab';
    tab.dataset.roomId = roomId;
    tab.innerHTML = `
        💬 ${escapeHtml(partnerName)}
        <span class="tab-close" onclick="closePrivateChat('${roomId}', event)">×</span>
    `;
    
    tab.onclick = () => switchChat(roomId);
    chatTabs.appendChild(tab);
    
    const chatContent = document.getElementById('chatContent');
    if (!chatContent) return;
    
    const chatWindow = document.createElement('div');
    chatWindow.className = 'chat-window';
    chatWindow.id = `chat_${roomId}`;
    chatWindow.innerHTML = `
        <div class="chat-header">
            <h3>Приватный чат с <span class="chat-partner">${escapeHtml(partnerName)}</span></h3>
            <button class="call-btn-in-chat" onclick="startVoiceCall('${partnerId}', '${escapeHtml(partnerName)}')"
                    style="background: #4CAF50; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer;">
                📞 Позвонить
            </button>
        </div>
        <div class="messages-container" id="messages_${roomId}"></div>
        <div class="message-input-area">
            <input type="text" class="message-input" id="input_${roomId}" 
                   placeholder="Написать ${escapeHtml(partnerName)}..." autocomplete="off"
                   onkeypress="handlePrivateKeyPress(event, '${roomId}')">
            <button class="send-btn" onclick="sendPrivateMessage('${roomId}')">Отправить</button>
        </div>
    `;
    
    chatContent.appendChild(chatWindow);
    
    activeChats.set(roomId, {
        partnerId: partnerId,
        partnerName: partnerName,
        element: chatWindow,
        tab: tab
    });
    
    ws.send(JSON.stringify({
        type: 'get_private_history',
        roomId: roomId
    }));
    
    switchChat(roomId);
}

function switchChat(chatId) {
    document.querySelectorAll('.chat-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.chat-window').forEach(window => window.classList.remove('active'));
    
    if (chatId === 'general') {
        const generalTab = document.querySelector('.chat-tab[data-chat="general"]');
        const generalChat = document.getElementById('generalChat');
        if (generalTab) generalTab.classList.add('active');
        if (generalChat) generalChat.classList.add('active');
        document.getElementById('generalMessageInput')?.focus();
    } else {
        const tab = document.querySelector(`.chat-tab[data-room-id="${chatId}"]`);
        const chatWindow = document.getElementById(`chat_${chatId}`);
        if (tab) tab.classList.add('active');
        if (chatWindow) chatWindow.classList.add('active');
        document.getElementById(`input_${chatId}`)?.focus();
    }
    currentChat = chatId;
}

function closePrivateChat(roomId, event) {
    if (event) event.stopPropagation();
    
    document.querySelector(`.chat-tab[data-room-id="${roomId}"]`)?.remove();
    document.getElementById(`chat_${roomId}`)?.remove();
    activeChats.delete(roomId);
    switchChat('general');
}

function sendPrivateMessage(roomId) {
    const input = document.getElementById(`input_${roomId}`);
    if (!input) return;
    
    const text = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: 'private_message',
        roomId: roomId,
        text: text
    }));
    
    input.value = '';
    input.focus();
}

function handlePrivateKeyPress(event, roomId) {
    if (event.key === 'Enter') sendPrivateMessage(roomId);
}

function displayPrivateMessage(messageData) {
    const roomId = messageData.roomId;
    const messagesContainer = document.getElementById(`messages_${roomId}`);
    
    if (!messagesContainer) {
        const partner = users.get(messageData.senderId);
        if (partner) {
            createPrivateChatTab(roomId, partner.username, messageData.senderId);
            setTimeout(() => displayPrivateMessage(messageData), 100);
        }
        return;
    }
    
    const messageElement = createMessageElement(messageData, true);
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function loadPrivateHistory(roomId, messages) {
    const messagesContainer = document.getElementById(`messages_${roomId}`);
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '';
    messages.forEach(message => {
        const messageElement = createMessageElement(message, true);
        messagesContainer.appendChild(messageElement);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createMessageElement(messageData, isPrivate = false) {
    const isOwn = messageData.senderId === currentUser.id || 
                  messageData.userId === currentUser.id;
    
    const time = new Date(messageData.time).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''} ${isPrivate ? 'private' : ''}`;
    
    const username = messageData.senderName || messageData.username;
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">
                ${escapeHtml(username)} ${isOwn ? '(Вы)' : ''}
            </span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${escapeHtml(messageData.text)}</div>
    `;
    
    return messageDiv;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Инициализация
document.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('usernameInput');
    if (usernameInput) {
        usernameInput.focus();
        usernameInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') connect();
        });
    }
    
    const generalTab = document.querySelector('.chat-tab[data-chat="general"]');
    if (generalTab) generalTab.onclick = () => switchChat('general');
});
