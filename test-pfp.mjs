import { createRequire } from "module";
const require = createRequire(import.meta.url + "/../packages/nextjs/");
const OpenAI = require("openai").default;
import { readFileSync, writeFileSync } from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const baseImage = readFileSync("packages/nextjs/public/clawd-base.jpg");
const base64 = baseImage.toString("base64");

const prompt = `Take this character — a red crystalline/geometric Pepe-style creature with an ethereum diamond-shaped head, wearing a black tuxedo with bow tie, holding a teacup — and modify it: wearing a viking helmet with horns and holding a battle axe. Keep the same art style (clean anime/cartoon illustration, white/light background, bold outlines). Keep the character recognizable but apply the requested changes. Square format, profile picture crop.`;

console.log("Generating PFP...");
const result = await openai.images.edit({
  model: "gpt-image-1.5",
  image: `data:image/jpeg;base64,${base64}`,
  prompt,
  n: 1,
  size: "1024x1024",
});

const imageData = result.data?.[0];
if (imageData?.b64_json) {
  const buf = Buffer.from(imageData.b64_json, "base64");
  writeFileSync("test-pfp-output.png", buf);
  console.log("✅ Saved to test-pfp-output.png");
} else {
  console.log("❌ No image data returned");
  console.log(JSON.stringify(result, null, 2));
}
