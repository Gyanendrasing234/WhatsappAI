// --- IMPORTS ---
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- VALIDATE ENVIRONMENT VARIABLES ---
// This is a security feature. The server will not start without these keys.
if (!process.env.GEMINI_API_KEY) {
  console.error("FATAL ERROR: GEMINI_API_KEY is not defined. Please check your .env file.");
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error("FATAL ERROR: MONGO_URI is not defined. Please check your .env file.");
  process.exit(1);
}

// --- INITIALIZATIONS ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // For deployment, change this to your Vercel frontend URL
    methods: ["GET", "POST"]
  }
});
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- MIDDLEWARE ---
app.use(cors());
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

    // The history needs to be in the format the SDK expects.
    // The last message from the user is what we send.
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

// This new secure route is for your frontend to call.
app.post('/ask-ai', async (req, res) => {
  try {
    const { prompt, userId } = req.body;
    if (!prompt || !userId) {
      return res.status(400).json({ error: "Prompt and userId are required." });
    }
    const chatId = getChatId(userId, 'ai_assistant');
    // Save user's message
    const userMessage = new Message({ chatId, senderId: userId, receiverId: 'ai_assistant', text: prompt });
    await userMessage.save();
    // Get history for context
    const history = await Message.find({ chatId }).sort({ timestamp: -1 }).limit(10);
    const chatHistoryForAI = history.reverse().map(msg => ({
      role: msg.senderId === 'ai_assistant' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));
    const aiResponseText = await getGeminiResponse(chatHistoryForAI);
    // Save AI's response
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

