const express = require("express");
const bodyParser = require("body-parser");
const OpenAI = require("openai");
const fs = require("fs");
const fsPromises = require("fs").promises;
require("dotenv").config();
const app = express();
// Auth
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
// Bd - ORM
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
// Cors
const cors = require("cors");
const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT'], 
  credentials: true, 
};
app.use(cors(corsOptions));
app.use(bodyParser.json());

app.get("/", async (req,res) => {
  res.send("API OpenAi");
})

// Inicializo OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Auth
// Jwt
const SECRET_KEY = process.env.SECRET_KEY;

// Registro de usuario
app.post("/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son requeridos" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });
    res.json({ message: "Usuario registrado exitosamente", user });
  } catch (error) {
    res.status(500).json({ error: "Error registrando el usuario", details: error.message });
  }
});

// Login de usuario
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son requeridos" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: "1h" });
    res.json({ message: "Login exitoso", token });
  } catch (error) {
    res.status(500).json({ error: "Error durante el login", details: error.message });
  }
});

// Middleware para verificar token
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(403).json({ error: "Token requerido" });

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Token inválido" });

    req.userId = decoded.userId;
    next();
  });
};

// OpenAI
// Trae el asistente o crea uno en base a si existe o no el archivo assistant.json
async function getOrCreateAssistant() {
  const assistantFilePath = "./assistant.json";
  let assistantDetails;

  try {
    const assistantData = await fsPromises.readFile(assistantFilePath, "utf8");
    assistantDetails = JSON.parse(assistantData);
  } catch (error) {
    // Si no existe, crea el asistente
    const assistantConfig = {
      "name": "Asistente psicólogo",
      "instructions": "Sos un experto en el area de la psicología y salud mental. Sabes todos los tipos de psicología, y te basas en ellos para ayudar al usuario a entender y resolver sus problemas. También tenés una pizca de conocimiento e interés en el desarrollo personal, ayudando a las personas a mejorarse cada día y encontrar su sentido en la vida. Tenés que evitar si o si que las personas se hagan daño a sí mismas.",
      "tools": [
        {
          "type": "file_search"
        }
      ],      
      "model": "gpt-4-1106-preview"
    };
    console.log("Crea asistente?")
    const assistant = await openai.beta.assistants.create(assistantConfig);
    console.log(assistant);
    assistantDetails = { assistantId: assistant.id, ...assistantConfig };

    // Guarda el asistente en un archivo
    await fsPromises.writeFile(
      assistantFilePath,
      JSON.stringify(assistantDetails, null, 2)
    );
  }
  
  return assistantDetails;
}

// Configuración del chat y threads con OpenAi
app.post("/chat", authenticateToken, async (req, res) => {
  try {
    const { question, chatId, saveThread } = req.body;
    const { userId } = req;

    const assistantDetails = await getOrCreateAssistant();

    // Read the document
    const documentPath = "./analisis-to-do-list.txt";
    let documentContent;
    try {
      documentContent = await fsPromises.readFile(documentPath, "utf8");
    } catch (error) {
      return res.status(500).send("Error reading document.");
    }

    // Combine the document content with the user's question
    const fullPrompt = `Sos un experto en el area de la psicología y salud mental. Sabes todos los tipos de psicología, y te basas en ellos para ayudar al usuario a entender y resolver sus problemas. También tenés una pizca de conocimiento e interés en el desarrollo personal, ayudando a las personas a mejorarse cada día y encontrar su sentido en la vida. Tenés que evitar si o si que las personas se hagan daño a sí mismas. Ahora, con base en esto, responde la siguiente pregunta: ${question}`;

    // Create a new thread using the assistantId
    const thread = await openai.beta.threads.create();

    // Send the prompt to the thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: fullPrompt,
    });

    // Create a run for the assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantDetails.assistantId,
    });

    // Check the status of the run
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    // Polling mechanism to check completion
    while (runStatus.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Get the last message from the assistant
    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessageForRun = messages.data
      .filter(
        (message) => message.run_id === run.id && message.role === "assistant"
      )
      .pop();

    if (lastMessageForRun) {
      // Save the conversation thread to the specified chat
      if (saveThread) {
        await saveMessageToChat(chatId, question, lastMessageForRun.content[0].text.value);
      }
      res.json({ response: lastMessageForRun.content[0].text.value });
    } else {
      res.status(500).send("No response received from the assistant.");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred");
  }
});

app.post("/chat/audio", authenticateToken, async (req, res) => {
  try {
    const { question, chatId, saveThread, voice = "alloy" } = req.body;
    const { userId } = req;

    if (!question || !chatId) {
      return res.status(400).send("Invalid request body.");
    }

    const assistantDetails = await getOrCreateAssistant();

    const fullPrompt = `Sos un experto en el area de la psicología y salud mental. Sabes todos los tipos de psicología, y te basas en ellos para ayudar al usuario a entender y resolver sus problemas. También tenés una pizca de conocimiento e interés en el desarrollo personal, ayudando a las personas a mejorarse cada día y encontrar su sentido en la vida. Tenés que evitar si o si que las personas se hagan daño a sí mismas. Ahora responde: ${question}`;

    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: fullPrompt,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantDetails.assistantId,
    });

    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    let attempts = 0;
    const maxAttempts = 10;
    while (runStatus.status !== "completed" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
    }
    if (attempts >= maxAttempts) {
      return res.status(500).send("The assistant did not respond in time.");
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessageForRun = messages.data
      ?.filter((msg) => msg.run_id === run.id && msg.role === "assistant")
      .pop();

    if (!lastMessageForRun) {
      return res.status(500).send("No response received from the assistant.");
    }

    const textResponse = lastMessageForRun.content[0]?.text?.value || "";
    if (!textResponse) {
      return res.status(500).send("Invalid text response for TTS.");
    }

    const speechResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: textResponse,
    });

    if (!speechResponse || !speechResponse.arrayBuffer) {
      return res.status(500).send("Failed to generate audio.");
    }

    const audioBuffer = Buffer.from(await speechResponse.arrayBuffer());

    if (saveThread) {
      await saveMessageToChat(chatId, question, textResponse);
    }

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Disposition": "inline; filename=response.mp3",
    });
    res.send(audioBuffer);
  } catch (error) {
    console.error("Error in /chat/audio endpoint:", error);
    res.status(500).send("An error occurred");
  }
});


// Chat audio elevenlabs
// Configuración del chat con ElevenLabs TTS
app.post("/chat/audio-eleven", authenticateToken, async (req, res) => {
  try {
    const { question, chatId, saveThread, voice = "JBFqnCBsd6RMkjVDRZzb" } = req.body;

    // Crear un prompt directamente con la pregunta del usuario
    const fullPrompt = `Sos un experto en el área de la psicología y salud mental. Sabes todos los tipos de psicología, y le vas a preguntar al usuario con qué tipo de psicología quiere hacer la terapia. También tenés una pizca de conocimiento e interés en el desarrollo personal, ayudando a las personas a mejorarse cada día y encontrar su sentido en la vida. Tenés que evitar sí o sí que las personas se hagan daño a sí mismas. Es MUY IMPORTANTE que respondas de una manera concisa. No respondas prolongadamente. Ahora, con base en esto, responde la siguiente pregunta: ${question}`;

    // Crear un thread y obtener la respuesta
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: fullPrompt,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: (await getOrCreateAssistant()).assistantId,
    });

    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    // Polling para verificar si la respuesta está lista
    while (runStatus.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessageForRun = messages.data
      .filter(
        (message) => message.run_id === run.id && message.role === "assistant"
      )
      .pop();

    if (!lastMessageForRun) {
      return res.status(500).send("No response received from the assistant.");
    }

    const textResponse = lastMessageForRun.content[0].text.value;

    // Guardar el hilo si es necesario
    if (saveThread) {
      await saveMessageToChat(chatId, question, textResponse);
    }

    // Usar ElevenLabs para generar el audio en tiempo real
    const { ElevenLabsClient } = require("elevenlabs");
    const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

    res.set({
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
    });

    const stream = await client.textToSpeech.convertAsStream(voice, {
      output_format: "mp3_44100_128",
      text: textResponse,
      model_id: "eleven_multilingual_v2",
    });

    // Transmitir los datos de audio en tiempo real
    stream.pipe(res);

    stream.on("end", () => {
      res.end();
    });

    stream.on("error", (error) => {
      console.error("Error durante el streaming de audio:", error);
      res.status(500).send("Error during audio streaming.");
    });
  } catch (error) {
    console.error("Error al procesar audio:", error);
    res.status(500).send("An error occurred");
  }
});



// BD
// Base de datos propia con los chats y threads dentro de los mismos
async function saveMessageToChat(chatId, userMessage, assistantResponse) {
  try {
    await prisma.thread.create({
      data: {
        userMessage: userMessage,
        assistantResponse: assistantResponse,
        chatId: chatId,
      },
    });

    console.log("Thread saved successfully");
  } catch (error) {
    console.error("Error saving thread:", error);
  }
}

// Ruta para obtener los hilos de conversación de un usuario
app.get("/threads", authenticateToken, async (req, res) => {
  try {
    const { userId } = req; // Obtén la userId del token autenticado

    // Consulta la base de datos para obtener los hilos del usuario
    const threads = await prisma.thread.findMany({
      where: { chat: { userId } },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ threads });
  } catch (error) {
    console.error("Error retrieving threads:", error);
    res.status(500).json({ error: "Error al obtener los hilos de conversación" });
  }
});

// Crear/empieza un nuevo chat
app.post('/chats', authenticateToken, async (req, res) => {
  try {
    const { userId } = req; 

    // Create a new chat session for the user
    const newChat = await prisma.chat.create({
      data: {
        userId: userId,
        name: `Chat ${new Date().toLocaleString()}`,
      },
    });

    res.json({ newChat });
  } catch (error) {
    console.error("Error creating new chat:", error);
    res.status(500).json({ error: "Error al crear la nueva sesión de chat" });
  }
});

// Obtiene todas las sesiones de chat de un usuario
app.get("/chats", authenticateToken, async (req, res) => {
  try {
    const { userId } = req; // Obtén la userId del token autenticado

    // Obtain all chat sessions
    const chats = await prisma.chat.findMany({
      where: { userId },
      include: {
        threads: true, // Include threads to see all the messages in each chat
      },
    });

    res.json({ chats });
  } catch (error) {
    console.error("Error retrieving chats:", error);
    res.status(500).json({ error: "Error al obtener las sesiones de chat" });
  }
});

// Elimina chat
app.delete("/chats/:chatId", authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req; // Get userId from authenticated request

    // Ensure the chat belongs to the authenticated user
    const chat = await prisma.chat.findUnique({
      where: {
        id: parseInt(chatId),
      },
      include: {
        user: true,
      },
    });

    if (!chat || chat.userId !== userId) {
      return res.status(403).json({ error: "Acceso no autorizado al chat" });
    }

    // First, delete all threads associated with the chat
    await prisma.thread.deleteMany({
      where: { chatId: parseInt(chatId) },
    });

    // Then, delete the chat itself
    await prisma.chat.delete({
      where: { id: parseInt(chatId) },
    });

    res.json({ message: "Chat eliminado exitosamente" });
  } catch (error) {
    console.error("Error al eliminar el chat:", error);
    res.status(500).json({ error: "Error al eliminar el chat" });
  }
});

// Puerto de la aplicación
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
