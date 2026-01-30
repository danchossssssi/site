let ws = null;
let currentUser = {
    id: null,
    username: null
};

let users = new Map();
let activeChats = new Map();
let currentChat = 'general';

// Подключение к WebSocket
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
        
        // Запрашиваем список пользователей
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
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        updateStatus('❌ Ошибка подключения', 'error');
    };
}

// Обновление статуса
function updateStatus(text, status) {
    const statusText = document.getElementById('statusText');
    const connectionDot = document.getElementById('connectionDot');
    
    if (statusText) {
        statusText.textContent = text;
    }
    
    if (connectionDot) {
        connectionDot.className = 'connection-dot';
        connectionDot.classList.add(status);
    }
    
    // Также обновляем статус на экране входа
    const loginStatusText = document.querySelector('#loginScreen .status-text');
    if (loginStatusText) {
        loginStatusText.textContent = text;
    }
}

// Показать кнопку переподключения
function showReconnectButton() {
    const loginScreen = document.getElementById('loginScreen');
    if (!loginScreen) return;
    
    loginScreen.style.display = 'flex';
    
    const loginForm = loginScreen.querySelector('.login-form');
    if (!loginForm) return;
    
    // Удаляем старую кнопку, если есть
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

// Обновление списка пользователей
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
        `;
        
        usersListElement.appendChild(userElement);
    });
}

// Загрузка истории общего чата
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

// Отображение сообщения общего чата
function displayGeneralMessage(messageData) {
    const messagesContainer = document.getElementById('generalMessages');
    if (!messagesContainer) return;
    
    const messageElement = createMessageElement(messageData, false);
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Отправка сообщения в общий чат
function sendGeneralMessage() {
    const input = document.getElementById('generalMessageInput');
    if (!input) return;
    
    const text = input.value.trim();
    
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'general_message',
        text: text
    }));
    
    input.value = '';
    input.focus();
}

function handleGeneralKeyPress(event) {
    if (event.key === 'Enter') {
        sendGeneralMessage();
    }
}

// Приватные чаты
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
        </div>
        <div class="messages-container" id="messages_${roomId}">
            <!-- Сообщения приватного чата -->
        </div>
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
    document.querySelectorAll('.chat-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.chat-window').forEach(window => {
        window.classList.remove('active');
    });
    
    if (chatId === 'general') {
        const generalTab = document.querySelector('.chat-tab[data-chat="general"]');
        if (generalTab) generalTab.classList.add('active');
        
        const generalChat = document.getElementById('generalChat');
        if (generalChat) generalChat.classList.add('active');
        
        document.getElementById('generalMessageInput')?.focus();
    } else {
        const tab = document.querySelector(`.chat-tab[data-room-id="${chatId}"]`);
        if (tab) tab.classList.add('active');
        
        const chatWindow = document.getElementById(`chat_${chatId}`);
        if (chatWindow) chatWindow.classList.add('active');
        
        document.getElementById(`input_${chatId}`)?.focus();
    }
    
    currentChat = chatId;
}

function closePrivateChat(roomId, event) {
    if (event) event.stopPropagation();
    
    const tab = document.querySelector(`.chat-tab[data-room-id="${roomId}"]`);
    if (tab) tab.remove();
    
    const chatWindow = document.getElementById(`chat_${roomId}`);
    if (chatWindow) chatWindow.remove();
    
    activeChats.delete(roomId);
    switchChat('general');
}

function sendPrivateMessage(roomId) {
    const input = document.getElementById(`input_${roomId}`);
    if (!input) return;
    
    const text = input.value.trim();
    
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'private_message',
        roomId: roomId,
        text: text
    }));
    
    input.value = '';
    input.focus();
}

function handlePrivateKeyPress(event, roomId) {
    if (event.key === 'Enter') {
        sendPrivateMessage(roomId);
    }
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

// Создание элемента сообщения
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

// Экранирование HTML
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
            if (event.key === 'Enter') {
                connect();
            }
        });
    }
    
    // Обработчики для переключения вкладок
    const generalTab = document.querySelector('.chat-tab[data-chat="general"]');
    if (generalTab) {
        generalTab.onclick = () => switchChat('general');
    }
});
