import { runLighthouse } from "../src/lighthouse";

const url = process.argv[2] ?? "https://example.com/";
const result = await runLighthouse(url, "desktop");
console.log(JSON.stringify(result, null, 2));
if (result.status !== "completed") process.exitCode = 1;
