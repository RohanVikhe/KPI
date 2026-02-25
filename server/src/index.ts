import { app } from "./app.js";
import { env } from "./config/env.js";
import { seedDefaultTemplate } from "./db/seedDefaultTemplate.js";

async function startServer() {
  try {
    await seedDefaultTemplate();
  } catch (error) {
    console.error("Failed to seed default template", error);
  }

  app.listen(env.PORT, () => {
    console.log(`API running on http://localhost:${env.PORT}`);
  });
}

startServer();
