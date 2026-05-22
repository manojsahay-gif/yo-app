/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';

dotenv.config();

// Ensure output is correct and we can bind properly
const app = express();
const PORT = 3000;

app.use(express.json());

interface UserInfo {
  username: string;
  phoneNumber?: string;
  userId?: string;
  color: string;
  isBot?: boolean;
  botPersonality?: string;
  lastYoReceivedAt?: string;
  isPending?: boolean;
  isOnline?: boolean;
  lastActiveAt?: string;
}

interface YoMsg {
  id: string;
  sender: string;
  receiver: string;
  timestamp: string;
  count: number;
  message?: string;
}

// Preseed the standard classic bots
const botUsers: UserInfo[] = [
  { username: 'yobot', phoneNumber: '1111', userId: 'YO-1111', color: '#ec4899', isBot: true, botPersonality: 'instant', isPending: false, isOnline: true, lastActiveAt: new Date().toISOString() },
  { username: 'chillyo', phoneNumber: '2222', userId: 'YO-2222', color: '#10b981', isBot: true, botPersonality: 'chill', isPending: false, isOnline: true, lastActiveAt: new Date().toISOString() },
  { username: 'hypeyo', phoneNumber: '3333', userId: 'YO-3333', color: '#f59e0b', isBot: true, botPersonality: 'hyper', isPending: false, isOnline: true, lastActiveAt: new Date().toISOString() },
  { username: 'grampayo', phoneNumber: '4444', userId: 'YO-4444', color: '#6366f1', isBot: true, botPersonality: 'slow', isPending: false, isOnline: true, lastActiveAt: new Date().toISOString() }
];

// Memory state stores
const registeredUsers: Map<string, UserInfo> = new Map(
  botUsers.map(b => [b.username.toLowerCase(), b])
);

const recentYos: YoMsg[] = [];
const sseClients: Map<string, express.Response[]> = new Map();

// Helper to push a YO event and dispatch to targets
function sendYoEvent(sender: string, receiver: string, message?: string) {
  const yoId = Math.random().toString(36).substring(2, 9);
  const now = new Date().toISOString();

  // Calculate YO sequence count between these two individuals
  const pairCount = recentYos.filter(
    y => (y.sender === sender && y.receiver === receiver) || 
         (y.sender === receiver && y.receiver === sender)
  ).length + 1;

  const yo: YoMsg = {
    id: yoId,
    sender,
    receiver,
    timestamp: now,
    count: pairCount,
    message: message || "YO!"
  };

  recentYos.push(yo);
  if (recentYos.length > 200) {
    recentYos.shift(); // keep memory tidy
  }

  // Update timestamps and online presence
  const recUser = registeredUsers.get(receiver.toLowerCase());
  if (recUser) {
    recUser.lastYoReceivedAt = now;
    recUser.lastActiveAt = now;
  }
  const sndUser = registeredUsers.get(sender.toLowerCase());
  if (sndUser) {
    sndUser.lastActiveAt = now;
  }

  // Dispatch to SSE clients registered under receiver
  const recvLower = receiver.toLowerCase();
  const clients = sseClients.get(recvLower) || [];
  clients.forEach(clientRes => {
    try {
      clientRes.write(`data: ${JSON.stringify(yo)}\n\n`);
    } catch (e) {
      console.error(`Error sending SSE to ${receiver}`, e);
    }
  });

  // Handlers for bots replying back!
  const targetUserObj = registeredUsers.get(recvLower);
  if (targetUserObj && targetUserObj.isBot) {
    handleBotResponse(sender, targetUserObj);
  }

  return yo;
}

// Emulate simple bot personalities responding back with flavor-rich notifications
function handleBotResponse(humanUser: string, bot: UserInfo) {
  let delay = 1500; // default 1.5s
  
  if (bot.botPersonality === 'chill') {
    // Random gap: 2 to 5 seconds
    delay = 2000 + Math.random() * 3000;
  } else if (bot.botPersonality === 'slow') {
    // Grandpas are slow
    delay = 5000;
  } else if (bot.botPersonality === 'hyper') {
    delay = 500; // Super fast response
  } else {
    delay = 1000;
  }

  setTimeout(() => {
    // Select personality message response
    let botMsg = "YO!";
    if (bot.botPersonality === 'chill') {
      const presets = ["Sup?", "Chillin'", "Take it easy", "Cool", "Mellow vibe"];
      botMsg = presets[Math.floor(Math.random() * presets.length)];
    } else if (bot.botPersonality === 'slow') {
      const presets = ["Who is this?", "What's that?", "How do I use this thing?", "Ah, hello", "Slow down son!"];
      botMsg = presets[Math.floor(Math.random() * presets.length)];
    } else if (bot.botPersonality === 'hyper') {
      const presets = ["LET'S GO!!!", "HYPED!!!", "YO YO YO!", "BOOM!", "AMAZING!!!"];
      botMsg = presets[Math.floor(Math.random() * presets.length)];
    } else {
      const presets = ["Sup?", "On my way!", "YO!", "What's up?"];
      botMsg = presets[Math.floor(Math.random() * presets.length)];
    }

    // Send standard YO notification back!
    sendYoEvent(bot.username, humanUser, botMsg);

    // If hyper, send an extra rapid double YO!
    if (bot.botPersonality === 'hyper') {
      setTimeout(() => {
        sendYoEvent(bot.username, humanUser, "BOOM!!!");
      }, 400);
    }
  }, delay);
}

// API: Get Users List
app.get('/api/users', (req, res) => {
  const usersArray = Array.from(registeredUsers.values());
  res.json(usersArray);
});

// API: Register User
app.post('/api/users/register', (req, res) => {
  const { username, phoneNumber, color, isPending } = req.body;

  if (!username || typeof username !== 'string') {
    res.status(400).json({ error: 'Username is required' });
    return;
  }

  const cleanUsername = username.trim().toLowerCase();
  
  if (cleanUsername.length < 2 || cleanUsername.length > 20) {
    res.status(400).json({ error: 'Username must be between 2 and 20 characters' });
    return;
  }

  // Allow spaces or underscores for custom unregistered labels etc.
  if (!/^[a-z0-9_\s\-]+$/i.test(cleanUsername)) {
    res.status(400).json({ error: 'Username can only contain alphanumeric characters, underscores, spaces, or hyphens' });
    return;
  }

  // Clean phone number (ignore hyphens, spaces, parentheses, keep + and digits)
  let cleanPhone = '';
  if (phoneNumber && typeof phoneNumber === 'string') {
    cleanPhone = phoneNumber.trim().replace(/[^0-9+]/g, '');
  }

  // 1. Check if a real registered user by this username already exists
  if (registeredUsers.has(cleanUsername)) {
    const existing = registeredUsers.get(cleanUsername)!;
    if (!existing.isPending && !isPending) {
      // Welcome back! Update login indicators
      if (cleanPhone && !existing.phoneNumber) {
        existing.phoneNumber = cleanPhone;
      }
      existing.color = color || existing.color;
      existing.isOnline = true;
      existing.lastActiveAt = new Date().toISOString();
      res.status(200).json({ status: 'existing', user: existing });
      return;
    }
  }

  // 2. See if there is a pending placeholder contact with this phone number or name
  if (cleanPhone) {
    const pendingPlaceholder = Array.from(registeredUsers.values()).find(
      u => u.isPending && u.phoneNumber && u.phoneNumber.replace(/[^0-9+]/g, '') === cleanPhone
    );
    if (pendingPlaceholder && !isPending) {
      // Upgrading an offline pending contact target!
      registeredUsers.delete(pendingPlaceholder.username.toLowerCase());
      
      pendingPlaceholder.username = username.trim();
      pendingPlaceholder.color = color || '#3b82f6';
      pendingPlaceholder.isPending = false;
      pendingPlaceholder.isOnline = true;
      pendingPlaceholder.lastActiveAt = new Date().toISOString();
      
      registeredUsers.set(cleanUsername, pendingPlaceholder);
      res.status(201).json({ status: 'created', user: pendingPlaceholder });
      return;
    }
  }

  // Create a beautiful short User ID (e.g. YO-4819)
  const codeSuffix = Math.floor(1000 + Math.random() * 9000);
  const randomId = `YO-${codeSuffix}`;

  const newUser: UserInfo = {
    username: username.trim(),
    phoneNumber: cleanPhone || undefined,
    userId: randomId,
    color: color || '#ec4899',
    isBot: false,
    isPending: isPending || false,
    isOnline: !isPending,
    lastActiveAt: new Date().toISOString()
  };

  registeredUsers.set(cleanUsername, newUser);
  res.status(201).json({ status: 'created', user: newUser });
});

// API: Send YO!
app.post('/api/yo', (req, res) => {
  const { sender, receiver, message } = req.body;

  if (!sender || !receiver) {
    res.status(400).json({ error: 'Both sender and receiver are required' });
    return;
  }

  const senderLower = sender.trim().toLowerCase();
  const receiverLower = receiver.trim().toLowerCase();

  if (!registeredUsers.has(senderLower)) {
    res.status(400).json({ error: `Sender "${sender}" is not registered` });
    return;
  }

  if (!registeredUsers.has(receiverLower)) {
    res.status(400).json({ error: `Receiver "${receiver}" which you are trying to YO does not exist` });
    return;
  }

  const yoEvent = sendYoEvent(sender.trim(), receiver.trim(), message);
  res.status(200).json({ status: 'sent', yo: yoEvent });
});

// API: Server-Sent Events (SSE) Stream for push-like notifications
app.get('/api/yo/stream', (req, res) => {
  const username = req.query.username;
  
  if (!username || typeof username !== 'string') {
    res.status(400).send('Username parameter is required.');
    return;
  }

  const userLower = username.trim().toLowerCase();

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // bypass proxy buffers
  });

  // Mark online on connection
  const activeUserObj = registeredUsers.get(userLower);
  if (activeUserObj) {
    activeUserObj.isOnline = true;
    activeUserObj.lastActiveAt = new Date().toISOString();
  }

  // Send an initial connected status
  res.write(`data: ${JSON.stringify({ status: 'listening', username })}\n\n`);

  // Record this response connection
  if (!sseClients.has(userLower)) {
    sseClients.set(userLower, []);
  }
  sseClients.get(userLower)!.push(res);

  // Periodic heartbeat / ping frame to bypass timeouts (very important for Cloud Run)
  const heartbeatInterval = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    const list = sseClients.get(userLower) || [];
    const index = list.indexOf(res);
    if (index !== -1) {
      list.splice(index, 1);
    }
    if (list.length === 0) {
      sseClients.delete(userLower);
      const offlineUserObj = registeredUsers.get(userLower);
      if (offlineUserObj) {
        offlineUserObj.isOnline = false;
        offlineUserObj.lastActiveAt = new Date().toISOString();
      }
    }
  });
});

async function startServer() {
  // Vite Integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Yo Notification Server] boot successfully on http://0.0.0.0:${PORT}`);
  });
}

startServer();
