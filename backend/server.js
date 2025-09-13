// --- IMPORTS ---
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- VALIDATE ENVIRONMENT VARIABLES ---
// THIS SECTION HAS BEEN RESTORED
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not defined.");
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error("FATAL ERROR: MONGO_URI is not defined.");
  process.exit(1);
}

// --- INITIALIZATIONS ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://whatsapp-ai.vercel.app",
      "https://whatsapp-8gjvx1ksg-gyanendra-singhs-projects-37973a81.vercel.app",
      "https://whatsapp-ai-delta.vercel.app"
    ],
    methods: ["GET", "POST"]
  }
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- MIDDLEWARE ---
app.use(cors({
  origin: [
    "https://whatsapp-ai.vercel.app",
    "https://whatsapp-8gjvx1ksg-gyanendra-singhs-projects-37973a81.vercel.app",
    "https://whatsapp-ai-delta.vercel.app"
  ]
}));
app.use(express.json());

// --- MONGODB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected successfully."))
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// --- MONGOOSE SCHEMAS ---
const userSchema = new mongoose.Schema({
  name: String,
  phone: { type: String, unique: true, required: true },
  uid: { type: String, unique: true, required: true },
  language: { type: String, default: 'en' },
  lastSeen: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  chatId: String,
  senderId: String,
  receiverId: String,
  text: String,
  translatedText: { type: String },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// --- HELPER FUNCTIONS ---
const getChatId = (id1, id2) => [id1, id2].sort().join('_');

// --- LLM INTEGRATION (FIXED) ---
const getGeminiResponse = async (chatHistory) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const historyForSDK = chatHistory.slice(0, -1).map(msg => ({
        role: msg.role,
        parts: msg.parts
    }));

    const lastMessage = chatHistory[chatHistory.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
        return "I'm not sure how to respond to that. Please ask a question.";
    }
    const lastUserPrompt = lastMessage.parts[0].text;

    const chat = model.startChat({ history: historyForSDK });
    const result = await chat.sendMessage(lastUserPrompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "I'm sorry, an unexpected error occurred.";
  }
};

// --- API ENDPOINTS ---
app.get('/messages/:user1Id/:user2Id', async (req, res) => {
  try {
    const { user1Id, user2Id } = req.params;
    const chatId = getChatId(user1Id, user2Id);
    
    const messages = await Message.find({ chatId }).sort({ timestamp: 'asc' });
    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "Server error fetching messages." });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { name, phone, language = 'en' } = req.body;
    const uid = phone;
    let user = await User.findOne({ uid });
    if (user) {
      return res.status(200).json({ message: "User already exists.", user });
    }
    const newUser = new User({ name, phone, uid, language });
    await newUser.save();
    res.status(201).json({ message: "User registered successfully.", user: newUser });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Server error during registration." });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await User.find({});
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Server error fetching users." });
  }
});

app.post('/ask-ai', async (req, res) => {
  try {
    const { prompt, userId } = req.body;
    if (!prompt || !userId) {
      return res.status(400).json({ error: "Prompt and userId are required." });
    }
    const chatId = getChatId(userId, 'ai_assistant');
    const userMessage = new Message({ chatId, senderId: userId, receiverId: 'ai_assistant', text: prompt });
    await userMessage.save();
    const history = await Message.find({ chatId }).sort({ timestamp: -1 }).limit(10);
    const chatHistoryForAI = history.reverse().map(msg => ({
      role: msg.senderId === 'ai_assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));
    const aiResponseText = await getGeminiResponse(chatHistoryForAI);
    const aiMessage = new Message({ chatId, senderId: 'ai_assistant', receiverId: userId, text: aiResponseText });
    await aiMessage.save();
    res.json({ response: aiResponseText });
  } catch (error) {
    console.error("Error in /ask-ai route:", error);
    res.status(500).json({ error: "Server error processing AI request." });
  }
});

// --- SOCKET.IO REAL-TIME LOGIC ---
let onlineUsers = {};
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.on('user_signed_in', (user) => {
    socket.userData = user;
    onlineUsers[user.uid] = { ...user, socketId: socket.id };
    io.emit('update_user_list', Object.values(onlineUsers));
  });

  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('send_message', async (data) => {
    try {
      const { text, senderId, receiverId } = data;
      const chatId = getChatId(senderId, receiverId);
      const messageToSave = new Message({ chatId, senderId, receiverId, text });
      await messageToSave.save();
      io.to(chatId).emit('receive_message', messageToSave);
      if (receiverId === 'ai_assistant') {
        const history = await Message.find({ chatId }).sort({ timestamp: -1 }).limit(10);
        const chatHistoryForAI = history.reverse().map(msg => ({
          role: msg.senderId === 'ai_assistant' ? 'model' : 'user',
          parts: [{ text: msg.text }]
        }));
        const aiResponseText = await getGeminiResponse(chatHistoryForAI);
        const aiMessage = new Message({ chatId, senderId: 'ai_assistant', receiverId: senderId, text: aiResponseText });
        await aiMessage.save();
        io.to(chatId).emit('receive_message', aiMessage);
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userData && onlineUsers[socket.userData.uid]) {
      delete onlineUsers[socket.userData.uid];
      io.emit('update_user_list', Object.values(onlineUsers));
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

// --- SERVER LISTENING ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));