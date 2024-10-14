const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const OpenAI = require("openai");
const fs = require("fs");
const fsPromises = require("fs").promises;
require("dotenv").config();
const app = express();

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST'], 
  credentials: true, 
};

app.use(cors(corsOptions));

app.use(bodyParser.json());

// Inicializo OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      "instructions": "You are a coding expert and you know everything about the project...",
      "tools": [{ "type": "code_interpreter" }, { "type": "retrieval" }],
      "model": "gpt-4-1106-preview"
    };

    const assistant = await openai.beta.assistants.create(assistantConfig);
    assistantDetails = { assistantId: assistant.id, ...assistantConfig };

    // Guarda el asistente en un archivo
    await fsPromises.writeFile(
      assistantFilePath,
      JSON.stringify(assistantDetails, null, 2)
    );
  }

  return assistantDetails;
}

// Ruta para manejar preguntas y usar OpenAI
app.post("/chat", async (req, res) => {
  try {

    console.log("Usando endpoint /chat");
    
    const { question } = req.body;
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
    const fullPrompt = `Aquí está un documento con información importante del proyecto:\n\n${documentContent}\n\nAhora, con base en esto, responde la siguiente pregunta: ${question}`;

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
      res.json({ response: lastMessageForRun.content[0].text.value });
    } else {
      res.status(500).send("No se recibió respuesta del asistente.");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Ocurrió un error");
  }
});

// Puerto de la aplicación
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
