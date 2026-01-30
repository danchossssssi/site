let ws = null;
let username = '';
const users = new Set();

function connect() {
    username = document.getElementById('usernameInput').value.trim();
    
    if (!username) {
        alert('Пожалуйста, введите имя пользователя');
        return;
    }
    
    if (username.length > 20) {
        alert('Имя не должно превышать 20 символов');
        return;
    }
    
    // Определяем протокол WebSocket (ws или wss)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    updateStatus('⏳ Подключение...');
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket соединение установлено');
        updateStatus('✅ Подключено');
        
        // Отправляем имя пользователя
        ws.send(JSON.stringify({
            type: 'set_username',
            username: username
        }));
        
        // Переключаем экран
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('chatScreen').style.display = 'flex';
        document.getElementById('messageInput').focus();
        
        // Добавляем приветственное сообщение
        addSystemMessage(`Добро пожаловать в чат, ${username}!`);
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'history':
                    // Очищаем чат перед загрузкой истории
                    document.getElementById('messages').innerHTML = '';
                    data.data.forEach(msg => addMessageToChat(msg));
                    break;
                    
                case 'new_message':
                    addMessageToChat(data.data);
                    break;
                    
                case 'user_joined':
                    users.add(data.username);
                    updateUsersList();
                    addSystemMessage(`🎉 ${data.username} присоединился к чату`);
                    break;
                    
                case 'user_left':
                    users.delete(data.username);
                    updateUsersList();
                    addSystemMessage(`👋 ${data.username} покинул чат`);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    };
    
    ws.onclose = (event) => {
        console.log('❌ WebSocket соединение закрыто');
        if (event.wasClean) {
            updateStatus('❌ Соединение закрыто');
        } else {
            updateStatus('❌ Соединение разорвано. Попробуйте переподключиться.');
        }
        
        // Показываем кнопку переподключения
        const messagesDiv = document.getElementById('messages');
        const reconnectDiv = document.createElement('div');
        reconnectDiv.className = 'system-message';
        reconnectDiv.innerHTML = `
            <p>Соединение потеряно</p>
            <button class="btn" onclick="location.reload()" 
                    style="margin-top: 10px; padding: 10px 20px; font-size: 14px;">
                🔄 Переподключиться
            </button>
        `;
        messagesDiv.appendChild(reconnectDiv);
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket ошибка:', error);
        updateStatus('❌ Ошибка подключения');
    };
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'message',
        text: text
    }));
    
    input.value = '';
    input.focus();
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function addMessageToChat(msg) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    
    const time = new Date(msg.time).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    // Выделяем собственные сообщения
    const isOwn = msg.username === username;
    messageDiv.style.borderLeftColor = isOwn ? '#764ba2' : '#667eea';
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-username">${msg.username} ${isOwn ? '(Вы)' : ''}</span>
            <span class="message-time">${time}</span>
        </div>
        <div class="message-text">${escapeHtml(msg.text)}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addSystemMessage(text) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'system-message';
    messageDiv.textContent = text;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateUsersList() {
    // В реальном приложении здесь бы обновлялся список пользователей
    console.log('Активные пользователи:', Array.from(users));
}

function updateStatus(text) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        statusEl.textContent = `Статус: ${text}`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Автофокус на поле ввода имени
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('usernameInput').focus();
});
