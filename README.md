<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3215f559-5d19-4a45-b6e1-bdb2a4673ed4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in `.env` or `.env` to your Gemini API key.
   The server loads `.env` first and falls back to `.env` if `.env` is missing.
3. Run the app:
   `npm run dev`
