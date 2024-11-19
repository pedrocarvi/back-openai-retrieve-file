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
  methods: ['GET', 'POST'], 
  credentials: true, 
};
app.use(cors(corsOptions));

app.use(bodyParser.json());

// Inicializo OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Auth
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

app.get("/", async (req,res) => {
  res.send("Api open ai");
})

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
      "name": "Code Project Assistant",
      "instructions": "You are a coding expert and you know everything about the project file that you retrieve. You have analyzed all the project with the information that we gave you in the file. You know how the project manages the environments, routes, api calls, and everything about the project. You are ready to build new components in the place that we tell you and know exactly how to write the code based from the project code standard. Only respond with code as plain text without code block syntax around it. ",
      "tools": [{ "type": "code_interpreter" }, { "type": "file_search" }],
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

// Guarda el thread del usuario
// async function saveThread(threadId, userMessage, assistantResponse) {
//   const threadsFilePath = "./threads.json";
//   let threadsData = [];

//   // Read existing threads if the file already exists
//   try {
//     const data = await fsPromises.readFile(threadsFilePath, "utf8");
//     threadsData = JSON.parse(data);
//   } catch (error) {
//     // If the file doesn't exist, initialize an empty array
//     if (error.code !== 'ENOENT') throw error;
//   }

//   // Define the new conversation
//   const newConversation = {
//     threadId,
//     timestamp: new Date().toISOString(),
//     userMessage,
//     assistantResponse
//   };

//   // Append the new conversation
//   threadsData.push(newConversation);

//   // Save back to the file
//   await fsPromises.writeFile(
//     threadsFilePath,
//     JSON.stringify(threadsData, null, 2)
//   );
// }

async function saveThread(userId, threadId, userMessage, assistantResponse) {
  try {
    await prisma.thread.create({
      data: {
        threadId,
        userMessage,
        assistantResponse,
        userId
      }
    });
    console.log("Thread saved successfully");
  } catch (error) {
    console.error("Error saving thread:", error);
  }
}

// Ruta para manejar preguntas y usar OpenAI
// app.post("/chat", authenticateToken, async (req, res) => {
//   try {

//     console.log("Usando endpoint /chat");
    
//     const { question } = req.body;
//     const assistantDetails = await getOrCreateAssistant();
//     console.log(assistantDetails);

//     // Lee el archivo 
//     const documentPath = "./analisis-to-do-list.txt";
//     let documentContent;
//     try {
//       documentContent = await fsPromises.readFile(documentPath, "utf8");
//     } catch (error) {
//       return res.status(500).send("Error leyendo el documento.");
//     }

//     // Combina el contenido del documento con la pregunta del usuario
//     const fullPrompt = `Aquí está un documento con información importante del proyecto:\n\n${documentContent}\n\n. Ahora, con base en esto, responde la siguiente pregunta: ${question}`;

//     // Crea un nuevo hilo usando el assistantId
//     const thread = await openai.beta.threads.create();

//     // Envía el prompt al hilo
//     await openai.beta.threads.messages.create(thread.id, {
//       role: "user",
//       content: fullPrompt,
//     });

//     // Crea un run para el asistente
//     const run = await openai.beta.threads.runs.create(thread.id, {
//       assistant_id: assistantDetails.assistantId,
//     });

//     // Verifica el estado del run
//     let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

//     // Mecanismo de polling para chequear si se completó
//     while (runStatus.status !== "completed") {
//       await new Promise((resolve) => setTimeout(resolve, 1000));
//       runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
//     }

//     // Obtiene el último mensaje del asistente
//     const messages = await openai.beta.threads.messages.list(thread.id);
//     const lastMessageForRun = messages.data
//       .filter(
//         (message) => message.run_id === run.id && message.role === "assistant"
//       )
//       .pop();

//     if (lastMessageForRun) {
//       // Save the conversation thread
//       await saveThread(thread.id, question, lastMessageForRun.content[0].text.value);
//       res.json({ response: lastMessageForRun.content[0].text.value });
//     } else {
//       res.status(500).send("No se recibió respuesta del asistente.");
//     }
//   } catch (error) {
//     console.error(error);
//     res.status(500).send("Ocurrió un error");
//   }
// });

// Ruta para manejar preguntas y usar OpenAI
app.post("/chat", authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;
    const { userId } = req; // Get userId from authenticated request

    const assistantDetails = await getOrCreateAssistant();

    // Lee el archivo
    const documentPath = "./analisis-to-do-list.txt";
    let documentContent;
    try {
      documentContent = await fsPromises.readFile(documentPath, "utf8");
    } catch (error) {
      return res.status(500).send("Error leyendo el documento.");
    }

    // Combina el contenido del documento con la pregunta del usuario
    const fullPrompt = `Aquí está un documento con información importante del proyecto:\n\n${documentContent}\n\n. Ahora, con base en esto, responde la siguiente pregunta: ${question}`;

    // Crea un nuevo hilo usando el assistantId
    const thread = await openai.beta.threads.create();

    // Envía el prompt al hilo
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: fullPrompt,
    });

    // Crea un run para el asistente
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantDetails.assistantId,
    });

    // Verifica el estado del run
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);

    // Mecanismo de polling para chequear si se completó
    while (runStatus.status !== "completed") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    // Obtiene el último mensaje del asistente
    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessageForRun = messages.data
      .filter(
        (message) => message.run_id === run.id && message.role === "assistant"
      )
      .pop();

    if (lastMessageForRun) {
      // Save the conversation thread to the database
      await saveThread(userId, thread.id, question, lastMessageForRun.content[0].text.value);
      res.json({ response: lastMessageForRun.content[0].text.value });
    } else {
      res.status(500).send("No se recibió respuesta del asistente.");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Ocurrió un error");
  }
});

// Ruta para obtener los hilos de conversación de un usuario
app.get("/threads", authenticateToken, async (req, res) => {
  try {
    const { userId } = req; // Obtén la userId del token autenticado

    // Consulta la base de datos para obtener los hilos del usuario
    const threads = await prisma.thread.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }, // Order by creation date, newest first
    });

    res.json({ threads });
  } catch (error) {
    console.error("Error retrieving threads:", error);
    res.status(500).json({ error: "Error al obtener los hilos de conversación" });
  }
});

// Puerto de la aplicación
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
