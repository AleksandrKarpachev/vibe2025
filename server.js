const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'secret_key';
const TELEGRAM_TOKEN = '7578447497:AAGjV-dLU19NsUtIxhVaBA-ZY1uczOxwACA';

const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '1234',
    database: 'todolist'
};

const pool = mysql.createPool(dbConfig);

async function checkDatabaseConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Connected to database');
        connection.release();
    } catch (error) {
        console.error('Database connection failed:', error);
        process.exit(1);
    }
}

checkDatabaseConnection();

app.use(bodyParser.json());
app.use(express.static('public'));

const authenticateJWT = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );
        
        res.status(201).json({ message: 'User registered' });
    } catch (error) {
        res.status(400).json({ error: 'Username already exists' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    const [users] = await pool.execute(
        'SELECT * FROM users WHERE username = ?',
        [username]
    );
    
    if (users.length === 0) return res.sendStatus(401);
    
    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) return res.sendStatus(401);
    
    const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
    
    res.json({ token });
});

app.get('/tasks', authenticateJWT, async (req, res) => {
    const [tasks] = await pool.execute(
        'SELECT id, text FROM tasks WHERE user_id = ?',
        [req.user.id]
    );
    res.json(tasks);
});

app.post('/tasks', authenticateJWT, async (req, res) => {
    const { text } = req.body;
    const [result] = await pool.execute(
        'INSERT INTO tasks (user_id, text) VALUES (?, ?)',
        [req.user.id, text]
    );
    res.status(201).json({ id: result.insertId, text });
});

app.put('/tasks/:id', authenticateJWT, async (req, res) => {
    const taskId = req.params.id;
    const { text } = req.body;

    try {
        await pool.execute(
            'UPDATE tasks SET text = ? WHERE id = ? AND user_id = ?',
            [text, taskId, req.user.id]
        );
        res.sendStatus(200);
    } catch (error) {
        console.error(error);
        res.sendStatus(500);
    }
});

app.delete('/tasks/:id', authenticateJWT, async (req, res) => {
    const taskId = req.params.id;
    await pool.execute(
        'DELETE FROM tasks WHERE id = ? AND user_id = ?',
        [taskId, req.user.id]
    );
    res.sendStatus(204);
});

app.post('/bind-telegram', authenticateJWT, async (req, res) => {
    const { telegramId } = req.body;
    await pool.execute(
        'UPDATE users SET telegram_id = ? WHERE id = ?',
        [telegramId, req.user.id]
    );
    res.json({ message: 'Telegram account bound' });
});

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Привет! Используй /bind для привязки аккаунта');
});

bot.onText(/\/bind/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
        'Введите команду в веб-интерфейсе: /bind ' + chatId
    );
});

bot.onText(/\/bind (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = match[1];
    
    try {
        await pool.execute(
            'UPDATE users SET telegram_id = ? WHERE id = ?',
            [chatId, userId]
        );
        bot.sendMessage(chatId, 'Аккаунт успешно привязан!');
    } catch (error) {
        bot.sendMessage(chatId, 'Ошибка привязки аккаунта');
    }
});

bot.onText(/\/add (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const text = match[1];
    
    try {
        const [users] = await pool.execute(
            'SELECT id FROM users WHERE telegram_id = ?',
            [chatId]
        );
        
        if (users.length === 0) {
            return bot.sendMessage(chatId, 'Сначала привяжите аккаунт через /bind');
        }
        
        const userId = users[0].id;
        await pool.execute(
            'INSERT INTO tasks (user_id, text) VALUES (?, ?)',
            [userId, text]
        );
        
        bot.sendMessage(chatId, 'Задача добавлена: ' + text);
    } catch (error) {
        bot.sendMessage(chatId, 'Ошибка добавления задачи');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});