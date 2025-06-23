const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'secret_key';

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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});