const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Хранилище данных
const messages = [];
const users = new Map();

// Middleware для статических файлов
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket обработка
wss.on('connection', (ws) => {
    console.log('Новое подключение');
    
    // Отправляем историю сообщений
    ws.send(JSON.stringify({
        type: 'history',
        data: messages.slice(-50)
    }));

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.type) {
                case 'set_username':
                    users.set(ws, message.username);
                    broadcast({
                        type: 'user_joined',
                        username: message.username,
                        time: new Date().toISOString()
                    }, ws);
                    break;
                    
                case 'message':
                    const msgData = {
                        id: uuidv4(),
                        username: users.get(ws) || 'Аноним',
                        text: message.text,
                        time: new Date().toISOString()
                    };
                    
                    messages.push(msgData);
                    broadcast({
                        type: 'new_message',
                        data: msgData
                    });
                    break;
            }
        } catch (error) {
            console.error('Ошибка:', error);
        }
    });

    ws.on('close', () => {
        const username = users.get(ws);
        if (username) {
            users.delete(ws);
            broadcast({
                type: 'user_left',
                username: username,
                time: new Date().toISOString()
            });
        }
    });
});

// Функция рассылки
function broadcast(data, excludeWs = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Обработка корневого пути
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера с поддержкой Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});