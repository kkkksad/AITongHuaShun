import { buildTradingApp } from "./app";
import { getConfig } from "./config";

const config = getConfig();
const app = await buildTradingApp({ config });

try {
  await app.listen({
    host: config.API_HOST,
    port: config.API_PORT,
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
