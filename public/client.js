let ws = null;
let currentUser = {
    id: null,
    username: null
};

let users = new Map();          // userId -> {username, online}
let activeChats = new Map();    // roomId -> {partnerId, partnerName, element}
let currentChat = 'general';    // ID активного чата

// Подключение к WebSocket
function connect() {
    const username = document.getElementById('usernameInput').value.trim();
    
    if (!username) {
        alert('Пожалуйста, введите имя пользователя');
        return;
    }
    
    if (username.length > 20) {
        alert('Имя не должно превышать 20 символов');
        return;
    }
    
    updateStatus('⏳ Подключение...');
    
    // Определяем протокол WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket соединение установлено');
        updateStatus('✅ Подключено');
        
        // Сохраняем данные пользователя
        currentUser.username = username;
        
        // Отправляем имя пользователя на сервер
        ws.send(JSON.stringify({
            type: 'set_username',
            username: username
        }));
        
        // Скрываем экран входа
        document.getElementById('loginScreen').style.display = 'none';
        
        // Обновляем отображение текущего пользователя
        document.getElementById('currentUsername').textContent = username;
        
        // Запрашиваем список пользователей
        ws.send(JSON.stringify({
            type: 'get_users'
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Получено:', data.type, data);
            
            switch (data.type) {
                case 'connected':
                    currentUser.id = data.userId;
                    break;
                    
                case 'user_list':
                    updateUsersList(data.users);
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
                    alert('Ошибка: ' + data.message);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    };
    
    ws.onclose = (event) => {
        console.log('❌ WebSocket соединение закрыто');
        updateStatus('❌ Отключено');
        
        // Показываем кнопку переподключения
        showReconnectButton();
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        updateStatus('❌ Ошибка подключения');
    };
}

// Обновление статуса подключения
function updateStatus(text) {
    const statusText = document.getElementById('statusText');
    const connectionDot = document.getElementById('connectionDot');
    
    if (statusText) {
        statusText.textContent = text;
    }
    
    if (connectionDot) {
        connectionDot.className = 'connection-dot ' + 
            (text.includes('✅') ? 'connected' : 'disconnected');
    }
}

// Показать кнопку переподключения
function showReconnectButton() {
    const loginScreen = document.getElementById('loginScreen');
    const loginForm = loginScreen.querySelector('.login-form');
    
    if (!loginForm.querySelector('.reconnect-btn')) {
        const reconnectBtn = document.createElement('button');
        reconnectBtn.className = 'btn';
        reconnectBtn.textContent = '🔄 Переподключиться';
        reconnectBtn.onclick = () => location.reload();
        reconnectBtn.style.marginTop = '15px';
        reconnectBtn.style.background = '#ff9800';
        
        loginForm.appendChild(reconnectBtn);
    }
    
    loginScreen.style.display = 'flex';
}

// Обновление списка пользователей
function updateUsersList(usersList) {
    const usersListElement = document.getElementById('usersList');
    const userCountElement = document.getElementById('userCount');
    
    // Очищаем список
    usersListElement.innerHTML = '';
    users.clear();
    
    // Обновляем счетчик
    if (userCountElement) {
        userCountElement.textContent = `Пользователей онлайн: ${usersList.length}`;
    }
    
    // Добавляем каждого пользователя
    usersList.forEach(user => {
        if (user.id === currentUser.id) return; // Пропускаем себя
        
        // Сохраняем в Map
        users.set(user.id, user);
        
        // Создаем элемент пользователя
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.dataset.userId = user.id;
        
        // Первая буква имени для аватарки
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
    
    // Обновляем счетчик в общем чате
    document.getElementById('onlineCount').textContent = usersList.length;
}

// Начать приватный чат
function startPrivateChat(targetUserId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert('Нет подключения к серверу');
        return;
    }
    
    // Проверяем, не открыт ли уже чат с этим пользователем
    for (const [roomId, chat] of activeChats.entries()) {
        if (chat.partnerId === targetUserId) {
            // Переключаемся на существующий чат
            switchChat(roomId);
            return;
        }
    }
    
    // Отправляем запрос на создание приватного чата
    ws.send(JSON.stringify({
        type: 'start_private_chat',
        targetUserId: targetUserId
    }));
}

// Создание вкладки приватного чата
function createPrivateChatTab(roomId, partnerName, partnerId) {
    // Проверяем, не существует ли уже такой вкладки
    if (activeChats.has(roomId)) {
        switchChat(roomId);
        return;
    }
    
    // Создаем вкладку
    const chatTabs = document.getElementById('chatTabs');
    const tab = document.createElement('div');
    tab.className = 'chat-tab';
    tab.dataset.roomId = roomId;
    tab.innerHTML = `
        💬 ${partnerName}
        <span class="tab-close" onclick="closePrivateChat('${roomId}', event)">×</span>
    `;
    
    tab.onclick = () => switchChat(roomId);
    chatTabs.appendChild(tab);
    
    // Создаем окно чата
    const chatContent = document.getElementById('chatContent');
    const chatWindow = document.createElement('div');
    chatWindow.className = 'chat-window';
    chatWindow.id = `chat_${roomId}`;
    chatWindow.innerHTML = `
        <div class="chat-header">
            <h3>Приватный чат с <span class="chat-partner">${partnerName}</span></h3>
        </div>
        <div class="messages-container" id="messages_${roomId}">
            <!-- Сообщения приватного чата -->
        </div>
        <div class="message-input-area">
            <input type="text" class="message-input" id="input_${roomId}" 
                   placeholder="Написать ${partnerName}..." autocomplete="off"
                   onkeypress="handlePrivateKeyPress(event, '${roomId}')">
            <button class="send-btn" onclick="sendPrivateMessage('${roomId}')">Отправить</button>
        </div>
    `;
    
    chatContent.appendChild(chatWindow);
    
    // Сохраняем информацию о чате
    activeChats.set(roomId, {
        partnerId: partnerId,
        partnerName: partnerName,
        element: chatWindow,
        tab: tab
    });
    
    // Запрашиваем историю чата
    ws.send(JSON.stringify({
        type: 'get_private_history',
        roomId: roomId
    }));
    
    // Переключаемся на новый чат
    switchChat(roomId);
}

// Переключение между чатами
function switchChat(chatId) {
    // Обновляем активные вкладки
    document.querySelectorAll('.chat-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    document.querySelectorAll('.chat-window').forEach(window => {
        window.classList.remove('active');
    });
    
    // Активируем выбранную вкладку
    const tab = document.querySelector(`.chat-tab[data-room-id="${chatId}"]`);
    if (tab) {
        tab.classList.add('active');
    } else {
        // Если это общий чат
        document.querySelector('.chat-tab[data-chat="general"]').classList.add('active');
    }
    
    // Активируем выбранное окно чата
    const chatWindow = document.getElementById(`chat_${chatId}`) || 
                       document.getElementById('generalChat');
    if (chatWindow) {
        chatWindow.classList.add('active');
    }
    
    currentChat = chatId;
    
    // Фокусируемся на поле ввода
    const input = document.getElementById(`input_${chatId}`) || 
                  document.getElementById('generalMessageInput');
    if (input) {
        input.focus();
    }
}

// Закрыть приватный чат
function closePrivateChat(roomId, event) {
    event.stopPropagation(); // Предотвращаем переключение чата
    
    // Удаляем вкладку
    const tab = document.querySelector(`.chat-tab[data-room-id="${roomId}"]`);
    if (tab) tab.remove();
    
    // Удаляем окно чата
    const chatWindow = document.getElementById(`chat_${roomId}`);
    if (chatWindow) chatWindow.remove();
    
    // Удаляем из активных чатов
    activeChats.delete(roomId);
    
    // Переключаемся на общий чат
    switchChat('general');
}

// Отправка сообщения в общий чат
function sendGeneralMessage() {
    const input = document.getElementById('generalMessageInput');
    const text = input.value.trim();
    
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }
    
    // В этой версии нет общего чата, только приватные
    // Но можно добавить позже
    input.value = '';
    input.focus();
}

function handleGeneralKeyPress(event) {
    if (event.key === 'Enter') {
        sendGeneralMessage();
    }
}

// Отправка приватного сообщения
function sendPrivateMessage(roomId) {
    const input = document.getElementById(`input_${roomId}`);
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

// Отображение приватного сообщения
function displayPrivateMessage(messageData) {
    const roomId = messageData.roomId;
    const messagesContainer = document.getElementById(`messages_${roomId}`);
    
    if (!messagesContainer) {
        // Если окно чата еще не создано, создаем его
        const partner = users.get(messageData.senderId);
        if (partner) {
            createPrivateChatTab(roomId, partner.username, messageData.senderId);
            // Повторно вызываем после создания
            setTimeout(() => displayPrivateMessage(messageData), 100);
        }
        return;
    }
    
    const messageElement = createMessageElement(messageData);
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Создание элемента сообщения
function createMessageElement(messageData) {
    const isOwn = messageData.senderId === currentUser.id;
    const time = new Date(messageData.time).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own' : ''} ${messageData.roomId ? 'private' : ''}`;
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">
                ${escapeHtml(messageData.senderName)} ${isOwn ? '(Вы)' : ''}
            </span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${escapeHtml(messageData.text)}</div>
    `;
    
    return messageDiv;
}

// Загрузка истории приватного чата
function loadPrivateHistory(roomId, messages) {
    const messagesContainer = document.getElementById(`messages_${roomId}`);
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '';
    
    messages.forEach(message => {
        const messageElement = createMessageElement(message);
        messagesContainer.appendChild(messageElement);
    });
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Автофокус на поле входа при загрузке
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('usernameInput').focus();
    
    // Обработка нажатия Enter в поле входа
    document.getElementById('usernameInput').addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            connect();
        }
    });
});
