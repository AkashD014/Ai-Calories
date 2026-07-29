
require("dotenv").config();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const express = require("express");
const cors = require("cors");
const path = require("path");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { GoogleGenAI } = require("@google/genai");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 5500;

// Trust Replit's reverse proxy so HTTPS cookies work correctly
app.set("trust proxy", 1);

app.use(cors({
  origin: "https://ai-calories-six.vercel.app",
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

// ── Session ──
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: "auto",   // auto = secure when behind HTTPS proxy
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// ── Google OAuth ──
// ── Google OAuth ──
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: "https://ai-calories-zn0k.onrender.com/auth/google/callback"
      },
      (accessToken, refreshToken, profile, done) => {
        const user = {
          id: profile.id,
          email: profile.emails?.[0]?.value || "",
          firstName:
            profile.name?.givenName ||
            profile.displayName?.split(" ")[0] ||
            "Friend",
          lastName: profile.name?.familyName || "",
          displayName: profile.displayName || "",
          photo: profile.photos?.[0]?.value || ""
        };

        return done(null, user);
      }
    )
  );

  console.log("Google OAuth configured");
} else {
  console.warn("Google OAuth credentials missing");
}

passport.serializeUser((user, done) => done(null, user));

passport.deserializeUser((user, done) => done(null, user));
// ── Auth routes ──
app.get("/auth/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));

app.get("/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/login"
  }),
  (req, res) => {
  res.redirect("https://ai-calories-six.vercel.app");
}
);

app.get("/api/user", (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ loggedIn: true, user: req.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// ── Gemini AI ──
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// ── Analyze endpoint ──
app.post("/api/analyze", (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Please log in first." });
  next();
}, async (req, res) => {
  try {
    const { imageData } = req.body;
    if (!imageData) return res.status(400).json({ error: "No image data provided." });

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
    const mimeType = imageData.match(/^data:(image\/\w+);base64,/)?.[1] || "image/jpeg";

    const prompt = `You are a professional nutritionist and food detection AI.

Analyze this image and detect any food items present.

Respond ONLY with a valid JSON object in this exact format (no markdown, no code blocks):
{
  "detected": true,
  "foodName": "name of the food",
  "calories": 250,
  "confidence": 87,
  "servingSize": "1 cup (240g)",
  "macros": {
    "protein": 12,
    "carbs": 35,
    "fat": 8
  },
  "notes": "brief note about the food"
}

If no food is detected respond with:
{
  "detected": false,
  "message": "No food detected in the image"
}

Rules:
- calories is an integer, realistic for a typical serving
- confidence is 0-100
- macros are in grams
- if multiple foods present, identify the dominant one`;

    console.log("Gemini API key exists:", !!process.env.GEMINI_API_KEY);
    console.log("Image MIME:", mimeType);
    console.log("Image size:", base64Data.length);
    console.log("Calling Gemini...");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    });

    const raw = response.text || "";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let result;
    try { result = JSON.parse(cleaned); }
    catch { return res.status(500).json({ error: "Failed to parse AI response", raw }); }

    res.json(result);
  } catch (err) {
    console.error("========== GEMINI ERROR ==========");
    console.error(err);
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);
    console.error("==================================");

    res.status(500).json({
      error: "AI analysis failed",
      details: err.message
    });
  }
});

// ── Static frontend ──
app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index1.html"));
});



console.log("Google Client:", GOOGLE_CLIENT_ID);
console.log("Google Secret:", GOOGLE_CLIENT_SECRET ? "Loaded" : "Missing");
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  if (!GOOGLE_CLIENT_ID) console.warn("⚠  GOOGLE_CLIENT_ID not set — OAuth disabled");
});
