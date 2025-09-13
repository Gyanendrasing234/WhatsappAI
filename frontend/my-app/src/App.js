import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import axios from 'axios';

// --- Configuration ---
// Make sure this points to your backend server.
// If your React app and server are on the same machine, this should work.
const SERVER_URL = 'https://whatsapppai-2.onrender.com';

// --- Main App Component ---
function App() {
  const [user, setUser] = useState(null); // The currently logged-in user
  const [view, setView] = useState('register'); // Controls which view is shown: 'register', 'login', 'chat'
  
  // Callback function to handle successful login/registration
  const handleAuthSuccess = (userData) => {
    setUser(userData);
    setView('chat');
  };

  return (
    <div className="font-sans bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen flex items-center justify-center">
      <div className="w-full max-w-6xl h-[95vh] bg-white dark:bg-gray-800 shadow-2xl rounded-2xl flex">
        {!user ? (
          <AuthScreen view={view} setView={setView} onAuthSuccess={handleAuthSuccess} />
        ) : (
          <ChatScreen currentUser={user} />
        )}
      </div>
    </div>
  );
}

// --- Authentication Screen Component ---
const AuthScreen = ({ view, setView, onAuthSuccess }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [error, setError] = useState('');

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!name || !phone) {
      setError('Name and phone number are required.');
      return;
    }
    try {
      const response = await axios.post(`${SERVER_URL}/register`, { name, phone, language });
      onAuthSuccess(response.data.user);
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. The phone number might already be in use.');
    }
  };
  
  const handleLogin = async (e) => {
      e.preventDefault();
      if (!phone) {
          setError('Phone number is required to log in.');
          return;
      }
      try {
          // In a real app, you'd have a /login endpoint.
          // For this app, we'll fetch all users and find the one with the matching phone number.
          const response = await axios.get(`${SERVER_URL}/users`);
          const existingUser = response.data.find(u => u.phone === phone);
          if (existingUser) {
              onAuthSuccess(existingUser);
          } else {
              setError('No user found with this phone number. Please register first.');
          }
      } catch (err) {
          setError('Failed to log in. Could not connect to the server.');
      }
  };


  const renderForm = () => {
    const isRegister = view === 'register';
    return (
      <form onSubmit={isRegister ? handleRegister : handleLogin} className="space-y-6">
        {error && <p className="text-red-500 bg-red-100 dark:bg-red-900/50 p-3 rounded-lg text-center">{error}</p>}
        
        {isRegister && (
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Jane Doe"
              />
            </div>
        )}

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</label>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 block w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., 9876543210"
          />
        </div>

        {isRegister && (
            <div>
                <label htmlFor="language" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Preferred Language</label>
                <select 
                    id="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="mt-1 block w-full px-4 py-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                </select>
            </div>
        )}

        <div>
          <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors">
            {isRegister ? 'Register' : 'Log In'}
          </button>
        </div>
      </form>
    );
  };

  return (
    <div className="w-full flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-4">Welcome to AI Chat</h1>
        <p className="text-center text-gray-500 dark:text-gray-400 mb-8">
          {view === 'register' ? 'Create an account to start chatting.' : 'Log in to your account.'}
        </p>
        
        <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-md">
            {renderForm()}
            <p className="mt-6 text-center text-sm">
                {view === 'register' ? 'Already have an account? ' : "Don't have an account? "}
                <button onClick={() => setView(view === 'register' ? 'login' : 'register')} className="font-medium text-blue-600 hover:text-blue-500">
                    {view === 'register' ? 'Log In' : 'Register'}
                </button>
            </p>
        </div>
      </div>
    </div>
  );
};


// --- Main Chat Screen Component ---
const ChatScreen = ({ currentUser }) => {
  const [users, setUsers] = useState([]);
  const [activeChat, setActiveChat] = useState(null); // State for UI rendering
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [playingAudio, setPlayingAudio] = useState(null); // ID of message being played
  
  const socket = useRef(null);
  const audioContext = useRef(null);
  const messagesEndRef = useRef(null);
  const activeChatRef = useRef(null); // Ref to hold current chat to be used in socket listeners

  // --- Utility to get a unique Chat ID ---
  const getChatId = (id1, id2) => [id1, id2].sort().join('_');

  // --- Effect for Socket Connection, User Fetching, and Listeners ---
  useEffect(() => {
    // This function fetches all registered users from the server
    const fetchAndSetUsers = async () => {
      try {
        const response = await axios.get(`${SERVER_URL}/users`);
        const aiAssistant = { uid: 'ai_assistant', name: 'AI Assistant', phone: 'AI', socketId: 'always-online' };
        const otherUsers = response.data
          .filter(u => u.uid !== currentUser.uid)
          .map(u => ({ ...u, socketId: null })); // Mark all users as offline initially
        setUsers([aiAssistant, ...otherUsers]);
      } catch (error) {
        console.error("Failed to fetch users:", error);
      }
    };
    
    fetchAndSetUsers();
    
    // Connect to the socket server
    socket.current = io(SERVER_URL);

    // Initialize AudioContext for playing TTS audio
    audioContext.current = new (window.AudioContext || window.webkitAudioContext)();

    // Tell the server that this user has signed in
    socket.current.emit('user_signed_in', currentUser);

    // Listen for updates to the user list and MERGE the online status
    socket.current.on('update_user_list', (onlineUsers) => {
        const onlineUserUids = onlineUsers.map(u => u.uid);
        
        setUsers(currentUsers => 
          currentUsers.map(user => {
            // If a user from our full list is in the online list, update their socketId
            if (onlineUserUids.includes(user.uid)) {
              return { ...user, socketId: onlineUsers.find(u => u.uid === user.uid).socketId };
            }
            // If they are not in the online list (and not the AI), mark them as offline
            if (user.uid !== 'ai_assistant') {
              return { ...user, socketId: null };
            }
            // Keep AI assistant as is
            return user;
          })
        );
    });

    // Listen for new messages
    socket.current.on('receive_message', (message) => {
        // Use the ref to check if the message is for the active chat
        if (activeChatRef.current && message.chatId === getChatId(currentUser.uid, activeChatRef.current.uid)) {
            setMessages(prevMessages => [...prevMessages, message]);
        }
    });
    
    // Listen for TTS audio data
    socket.current.on('receive_tts_audio', async ({ audioData, mimeType, messageId }) => {
        if (audioData) {
            try {
                const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)[1], 10);
                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const audioBuffer = await pcmToAudioBuffer(pcm16, sampleRate);
                
                const source = audioContext.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.current.destination);
                source.start(0);
                setPlayingAudio(messageId);
                source.onended = () => setPlayingAudio(null);
            } catch (error) {
                console.error("Error playing TTS audio:", error);
                setPlayingAudio(null);
            }
        }
    });

    // Disconnect socket on component unmount
    return () => {
      socket.current.disconnect();
    };
  }, [currentUser]); // This effect only depends on currentUser, preventing unnecessary re-connections

  // --- Effect to scroll to the latest message ---
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  // --- Handlers ---
  const selectChat = async (user) => {
    setActiveChat(user);
    activeChatRef.current = user; // Update the ref for socket listeners
    setMessages([]); // Clear previous messages
    const chatId = getChatId(currentUser.uid, user.uid);
    
    // Fetch message history for the selected chat
    try {
      const response = await axios.get(`${SERVER_URL}/messages/${currentUser.uid}/${user.uid}`);
      setMessages(response.data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
    
    // Join the socket room for this chat
    socket.current.emit('join_chat', chatId);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim() && activeChat) {
      const messageData = {
        text: newMessage,
        senderId: currentUser.uid,
        receiverId: activeChat.uid,
        senderLanguage: currentUser.language
      };
      socket.current.emit('send_message', messageData);
      setNewMessage('');
    }
  };
  
  const handleSummarize = () => {
    if (activeChat && messages.length > 0) {
        const chatId = getChatId(currentUser.uid, activeChat.uid);
        socket.current.emit('summarize_chat', {
            chatId,
            messages,
            senderId: currentUser.uid,
            receiverId: activeChat.uid
        });
    }
  };
  
  const handleTTS = (text, messageId) => {
    if (playingAudio === messageId) return; // Don't request if already playing
    socket.current.emit('get_tts_audio', { text, messageId });
  };
  
  // --- Audio Conversion Helpers ---
  const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const pcmToAudioBuffer = async (pcm16, sampleRate) => {
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0; // Convert 16-bit PCM to Float32
    }
    const buffer = audioContext.current.createBuffer(1, float32.length, sampleRate);
    buffer.copyToChannel(float32, 0);
    return buffer;
  };


  return (
    <>
      {/* User List Sidebar */}
      <div className="w-1/3 xl:w-1/4 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-xl font-bold">Chats</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Logged in as: {currentUser.name}</p>
        </div>
        <div className="flex-grow overflow-y-auto">
          {users.map((user) => (
            <div
              key={user.uid}
              onClick={() => selectChat(user)}
              className={`p-4 flex items-center space-x-4 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors ${activeChat?.uid === user.uid ? 'bg-blue-100 dark:bg-blue-900/50' : ''}`}
            >
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-blue-500 text-white flex items-center justify-center text-xl font-bold">
                    {user.name.charAt(0).toUpperCase()}
                </div>
                {user.socketId && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-800"></div>}
              </div>
              <div className="flex-grow">
                <h3 className="font-semibold">{user.name}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.phone}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Window */}
      <div className="w-2/3 xl:w-3/4 flex flex-col bg-gray-100 dark:bg-gray-900">
        {activeChat ? (
          <>
            {/* Chat Header */}
            <div className="p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center shadow-sm">
                <div>
                    <h3 className="text-lg font-bold">{activeChat.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{activeChat.socketId ? 'Online' : 'Offline'}</p>
                </div>
                {activeChat.uid !== 'ai_assistant' && (
                    <button onClick={handleSummarize} className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors">
                        Summarize Chat
                    </button>
                )}
            </div>

            {/* Messages Area */}
            <div className="flex-grow p-6 overflow-y-auto space-y-4">
              {messages.map((msg, index) => (
                <div key={index} className={`flex items-end gap-2 ${msg.senderId === currentUser.uid ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-lg p-3 rounded-2xl ${msg.senderId === currentUser.uid ? 'bg-blue-600 text-white rounded-br-lg' : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-lg'}`}>
                    <p className="text-sm">{msg.text}</p>
                    <p className="text-xs opacity-70 mt-1 text-right">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <button onClick={() => handleTTS(msg.text, msg._id || index)} className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${playingAudio === (msg._id || index) ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 2a.75.75 0 01.75.75v14.5a.75.75 0 01-1.5 0V2.75A.75.75 0 0110 2zM4.5 9a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zM15 9.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75zM6.5 6a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zM13 6.75a.75.75 0 01.75-.75h.5a.75.75 0 010 1.5h-.5a.75.75 0 01-.75-.75z" />
                    </svg>
                  </button>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              <form onSubmit={handleSendMessage} className="flex items-center space-x-4">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-grow px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="submit" className="bg-blue-600 text-white rounded-full p-3 hover:bg-blue-700 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-grow flex items-center justify-center">
            <div className="text-center text-gray-500 dark:text-gray-400">
              <h2 className="text-2xl font-medium">Select a chat to start messaging</h2>
              <p>Choose a user from the list on the left.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default App;
