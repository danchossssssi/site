const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилища данных
const users = new Map();           // ws -> {id, username, online}
const privateRooms = new Map();    // roomId -> {user1, user2, messages[]}
const generalMessages = [];        // Сообщения общего чата

// Генерация ID комнаты
function generateRoomId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

// Middleware для статических файлов
app.use(express.static(__dirname)); // Исправлено: ищем файлы в корне

// WebSocket обработка
wss.on('connection', (ws) => {
    console.log('Новое подключение');
    const userId = uuidv4();
    
    // Отправляем приветственное сообщение
    ws.send(JSON.stringify({
        type: 'connected',
        userId: userId
    }));

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'set_username':
                    // Регистрация пользователя
                    users.set(ws, {
                        id: userId,
                        username: message.username,
                        online: true
                    });
                    
                    // Отправляем историю общего чата
                    ws.send(JSON.stringify({
                        type: 'general_history',
                        messages: generalMessages.slice(-50)
                    }));
                    
                    // Обновляем список пользователей
                    broadcastUserList();
                    break;
                    
                case 'get_users':
                    sendUserList(ws);
                    break;
                    
                case 'start_private_chat':
                    startPrivateChat(ws, message.targetUserId);
                    break;
                    
                case 'private_message':
                    sendPrivateMessage(ws, message.roomId, message.text);
                    break;
                    
                case 'general_message':
                    // ОБЩИЙ ЧАТ: Сохраняем и рассылаем сообщение
                    const user = users.get(ws);
                    if (user) {
                        const msg = {
                            id: uuidv4(),
                            userId: user.id,
                            username: user.username,
                            text: message.text,
                            time: new Date().toISOString()
                        };
                        
                        generalMessages.push(msg);
                        
                        // Рассылаем всем
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({
                                    type: 'general_message',
                                    data: msg
                                }));
                            }
                        });
                    }
                    break;
                    
                case 'get_private_history':
                    sendPrivateHistory(ws, message.roomId);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });

    ws.on('close', () => {
        const user = users.get(ws);
        if (user) {
            user.online = false;
            broadcastUserList();
        }
        users.delete(ws);
    });
});

// Функции для приватных чатов
function startPrivateChat(initiatorWs, targetUserId) {
    const initiator = users.get(initiatorWs);
    if (!initiator) return;
    
    // Находим целевого пользователя
    let targetWs = null;
    for (const [ws, user] of users.entries()) {
        if (user.id === targetUserId) {
            targetWs = ws;
            break;
        }
    }
    
    if (!targetWs) {
        initiatorWs.send(JSON.stringify({
            type: 'error',
            message: 'Пользователь не в сети'
        }));
        return;
    }
    
    const targetUser = users.get(targetWs);
    
    // Создаем или получаем комнату
    const roomId = generateRoomId(initiator.id, targetUserId);
    if (!privateRooms.has(roomId)) {
        privateRooms.set(roomId, {
            users: [initiator.id, targetUserId],
            messages: []
        });
    }
    
    // Уведомляем пользователей
    [initiatorWs, targetWs].forEach(ws => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'private_room_created',
                roomId: roomId,
                partner: ws === initiatorWs ? targetUser.username : initiator.username,
                partnerId: ws === initiatorWs ? targetUserId : initiator.id
            }));
        }
    });
}

function sendPrivateMessage(senderWs, roomId, text) {
    const sender = users.get(senderWs);
    if (!sender || !privateRooms.has(roomId)) return;
    
    const room = privateRooms.get(roomId);
    if (!room.users.includes(sender.id)) return;
    
    // Создаем сообщение
    const message = {
        id: uuidv4(),
        senderId: sender.id,
        senderName: sender.username,
        text: text,
        time: new Date().toISOString(),
        roomId: roomId
    };
    
    // Сохраняем
    room.messages.push(message);
    
    // Находим получателя
    const receiverId = room.users.find(id => id !== sender.id);
    let receiverWs = null;
    for (const [ws, user] of users.entries()) {
        if (user.id === receiverId) {
            receiverWs = ws;
            break;
        }
    }
    
    // Отправляем
    const sendMessage = (ws) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'private_message',
                data: message
            }));
        }
    };
    
    sendMessage(senderWs);
    sendMessage(receiverWs);
}

function sendPrivateHistory(ws, roomId) {
    const user = users.get(ws);
    if (!user || !privateRooms.has(roomId)) return;
    
    const room = privateRooms.get(roomId);
    if (!room.users.includes(user.id)) return;
    
    ws.send(JSON.stringify({
        type: 'private_history',
        roomId: roomId,
        messages: room.messages.slice(-100)
    }));
}

// Функции для списка пользователей
function broadcastUserList() {
    const userList = Array.from(users.values())
        .filter(user => user.online)
        .map(user => ({
            id: user.id,
            username: user.username,
            online: user.online
        }));
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'user_list',
                users: userList
            }));
        }
    });
}

function sendUserList(ws) {
    const userList = Array.from(users.values())
        .filter(user => user.online)
        .map(user => ({
            id: user.id,
            username: user.username,
            online: user.online
        }));
    
    ws.send(JSON.stringify({
        type: 'user_list',
        users: userList
    }));
}

// Маршруты
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // Исправлено: без public/
});

app.get('/client.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'client.js'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
