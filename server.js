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

// ===== ДОБАВЛЕНО: Хранилище для групповых звонков =====
const groupCalls = new Map();      // callId -> {participants: Set(userIds), creatorId}

// Генерация ID комнаты
function generateRoomId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

// Поиск WebSocket по userId
function findWsByUserId(userId) {
    for (const [ws, user] of users.entries()) {
        if (user.id === userId) {
            return ws;
        }
    }
    return null;
}

// Middleware для статических файлов
app.use(express.static(__dirname));

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
                    
                // ===== ЗВОНКИ (приватные) =====
                case 'call_offer':
                    // Пересылаем предложение о звонке получателю
                    const receiverWs = findWsByUserId(message.targetUserId);
                    if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
                        receiverWs.send(JSON.stringify({
                            type: 'call_offer',
                            offer: message.offer,
                            callerId: userId,
                            callerName: users.get(ws)?.username || 'Неизвестный',
                            callId: message.callId || uuidv4()
                        }));
                        console.log(`Переслан offer от ${userId} к ${message.targetUserId}`);
                    } else {
                        ws.send(JSON.stringify({
                            type: 'call_error',
                            message: 'Пользователь не в сети'
                        }));
                    }
                    break;
                    
                case 'call_answer':
                    // Пересылаем ответ на звонок инициатору
                    const callerWs = findWsByUserId(message.callerId);
                    if (callerWs && callerWs.readyState === WebSocket.OPEN) {
                        callerWs.send(JSON.stringify({
                            type: 'call_answer',
                            answer: message.answer,
                            callId: message.callId
                        }));
                        console.log(`Переслан answer к ${message.callerId}`);
                    }
                    break;
                    
                case 'ice_candidate':
                    // Пересылаем ICE-кандидата
                    const targetWs = findWsByUserId(message.targetUserId);
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify({
                            type: 'ice_candidate',
                            candidate: message.candidate,
                            callId: message.callId
                        }));
                    }
                    break;
                    
                case 'end_call':
                    // Уведомляем другую сторону о завершении звонка
                    const otherUserWs = findWsByUserId(message.targetUserId);
                    if (otherUserWs && otherUserWs.readyState === WebSocket.OPEN) {
                        otherUserWs.send(JSON.stringify({
                            type: 'call_ended',
                            callId: message.callId
                        }));
                    }
                    break;
                    
                case 'reject_call':
                    // Уведомляем звонящего об отклонении звонка
                    const callerWsReject = findWsByUserId(message.callerId);
                    if (callerWsReject && callerWsReject.readyState === WebSocket.OPEN) {
                        callerWsReject.send(JSON.stringify({
                            type: 'call_rejected',
                            callId: message.callId
                        }));
                    }
                    break;
                    
                // ===== ДОБАВЛЕНО: ГРУППОВЫЕ ЗВОНКИ В ОБЩИЙ ЧАТ =====
                case 'group_call_start':
                    // Создание группового звонка
                    const callId = message.callId || `group_${uuidv4()}`;
                    groupCalls.set(callId, {
                        participants: new Set([userId]),
                        creatorId: userId,
                        creatorName: users.get(ws)?.username || 'Неизвестный'
                    });
                    
                    // Уведомляем всех в общем чате
                    broadcastToGeneralChat({
                        type: 'group_call_started',
                        callId: callId,
                        creatorName: users.get(ws)?.username,
                        creatorId: userId
                    });
                    break;
                    
                case 'group_call_join':
                    // Пользователь хочет присоединиться к групповому звонку
                    const call = groupCalls.get(message.callId);
                    if (call) {
                        call.participants.add(userId);
                        
                        // Отправляем участнику список уже подключенных
                        ws.send(JSON.stringify({
                            type: 'group_call_participants',
                            callId: message.callId,
                            participants: Array.from(call.participants).map(pid => {
                                const userWs = findWsByUserId(pid);
                                return userWs ? users.get(userWs)?.username : 'Unknown';
                            })
                        }));
                        
                        // Уведомляем всех о новом участнике
                        broadcastToCallParticipants(message.callId, {
                            type: 'group_call_user_joined',
                            callId: message.callId,
                            userId: userId,
                            username: users.get(ws)?.username
                        }, userId);
                    }
                    break;
                    
                case 'group_call_leave':
                    // Пользователь покидает групповой звонок
                    const callToLeave = groupCalls.get(message.callId);
                    if (callToLeave) {
                        callToLeave.participants.delete(userId);
                        
                        // Если участников не осталось, удаляем звонок
                        if (callToLeave.participants.size === 0) {
                            groupCalls.delete(message.callId);
                        } else {
                            // Уведомляем остальных
                            broadcastToCallParticipants(message.callId, {
                                type: 'group_call_user_left',
                                callId: message.callId,
                                userId: userId,
                                username: users.get(ws)?.username
                            });
                        }
                    }
                    break;
                    
                case 'group_call_signal':
                    // Пересылка сигналов WebRTC между участниками группового звонка
                    const targetCall = groupCalls.get(message.callId);
                    if (targetCall && targetCall.participants.has(userId)) {
                        // Отправляем сигнал всем, кроме отправителя
                        targetCall.participants.forEach(participantId => {
                            if (participantId !== userId) {
                                const participantWs = findWsByUserId(participantId);
                                if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                                    participantWs.send(JSON.stringify({
                                        type: 'group_call_signal',
                                        callId: message.callId,
                                        senderId: userId,
                                        signal: message.signal
                                    }));
                                }
                            }
                        });
                    }
                    break;
                    
                case 'group_call_end':
                    // Создатель завершает групповой звонок
                    const callToEnd = groupCalls.get(message.callId);
                    if (callToEnd && callToEnd.creatorId === userId) {
                        // Уведомляем всех участников
                        broadcastToCallParticipants(message.callId, {
                            type: 'group_call_ended',
                            callId: message.callId,
                            endedBy: users.get(ws)?.username
                        });
                        
                        // Удаляем звонок
                        groupCalls.delete(message.callId);
                    }
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
            
            // Удаляем пользователя из всех групповых звонков
            groupCalls.forEach((call, callId) => {
                if (call.participants.has(user.id)) {
                    call.participants.delete(user.id);
                    
                    // Уведомляем остальных участников
                    broadcastToCallParticipants(callId, {
                        type: 'group_call_user_left',
                        callId: callId,
                        userId: user.id,
                        username: user.username
                    });
                    
                    // Если участников не осталось, удаляем звонок
                    if (call.participants.size === 0) {
                        groupCalls.delete(callId);
                    }
                }
            });
        }
        users.delete(ws);
        console.log(`Пользователь ${user?.username || userId} отключился`);
    });
});

// ===== ДОБАВЛЕНЫ ФУНКЦИИ ДЛЯ ГРУППОВЫХ ЗВОНКОВ =====

// Рассылка сообщения всем участникам группового звонка
function broadcastToCallParticipants(callId, message, excludeUserId = null) {
    const call = groupCalls.get(callId);
    if (!call) return;
    
    call.participants.forEach(participantId => {
        if (participantId !== excludeUserId) {
            const participantWs = findWsByUserId(participantId);
            if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                participantWs.send(JSON.stringify(message));
            }
        }
    });
}

// Рассылка сообщения всем в общем чате
function broadcastToGeneralChat(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// ===== ФУНКЦИИ ДЛЯ ПРИВАТНЫХ ЧАТОВ =====
function startPrivateChat(initiatorWs, targetUserId) {
    const initiator = users.get(initiatorWs);
    if (!initiator) return;
    
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
    const roomId = generateRoomId(initiator.id, targetUserId);
    
    if (!privateRooms.has(roomId)) {
        privateRooms.set(roomId, {
            users: [initiator.id, targetUserId],
            messages: []
        });
    }
    
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
    
    const message = {
        id: uuidv4(),
        senderId: sender.id,
        senderName: sender.username,
        text: text,
        time: new Date().toISOString(),
        roomId: roomId
    };
    
    room.messages.push(message);
    
    const receiverId = room.users.find(id => id !== sender.id);
    let receiverWs = null;
    for (const [ws, user] of users.entries()) {
        if (user.id === receiverId) {
            receiverWs = ws;
            break;
        }
    }
    
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
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/client.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'client.js'));
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Поддерживаются групповые звонки в общем чате!`);
});
