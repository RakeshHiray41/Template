const express = require("express");
const multer = require("multer");
const bodyParser = require("body-parser");
const fs = require("fs").promises;
const path = require("path");
const cors = require("cors");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const ImageModule = require('docxtemplater-image-module-free');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.static("public"));
app.use(bodyParser.json());

// Configure multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage: storage });

// Update multer to accept both template and logo
const uploadFields = upload.fields([
  { name: 'template', maxCount: 1 },
  { name: 'logo', maxCount: 1 }
]);

// Endpoint to handle document upload and extract placeholders
app.post("/upload", upload.single("template"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }    const templateFile = await fs.readFile(req.file.path);
    const zip = new PizZip(templateFile);
    const doc = new Docxtemplater(zip);
    const uniqueTags = new Set();

    try {
      // Get the full template content
      const text = doc.getFullText();
      console.log("Template content:", text);
      
      // Find all tags in the format {tagname}
      const regex = /\{([^}]+)\}/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        uniqueTags.add(match[1]);
      }

      const tags = Array.from(uniqueTags);
      console.log("Found tags:", tags);

      if (tags.length === 0) {
        return res.status(400).json({
          error:
            "No template tags found in the document. Please ensure your document contains valid template tags in the format {tagname}. Example: {name}, {date}, {email}",
        });
      }

      res.json({
        uploadedFile: req.file.filename,
        placeholders: tags,
      });
    } catch (parseError) {
      console.error("Parse error:", parseError);
      return res.status(400).json({
        error:
          "Failed to parse template tags. Please ensure your document is a valid DOCX file with template tags in the format {tagname}.",
      });
    }
  } catch (error) {
    console.error("File error:", error);
    res.status(500).json({
      error:
        "Error processing template file. Please ensure your document is a valid DOCX file.",
    });
  }
});

// Endpoint to generate document with filled placeholders and logo
app.post("/generate", uploadFields, async (req, res) => {
  try {
    const { filename, data } = req.body;
    const templatePath = path.join(__dirname, "uploads", filename);
    const template = await fs.readFile(templatePath);
    const zip = new PizZip(template);

    // Prepare image module options
    let imageOpts = {
      centered: false,
      getImage: function(tagValue) {
        // tagValue is the path to the image file
        return fs.readFile(tagValue);
      },
      getSize: function() {
        return [150, 150]; // width, height in px
      }
    };

    // If a logo was uploaded, get its path
    let logoPath = null;
    if (req.files && req.files.logo && req.files.logo[0]) {
      logoPath = req.files.logo[0].path;
    }

    // Add the logo path to the data if present
    let docData = typeof data === 'string' ? JSON.parse(data) : data;
    if (logoPath) {
      docData.logo = logoPath;
    }

    const imageModule = new ImageModule(imageOpts);
    const doc = new Docxtemplater(zip, { modules: [imageModule] });
    doc.setData(docData);
    doc.render();
    const buffer = doc.getZip().generate({ type: 'nodebuffer' });
    const outputPath = path.join(__dirname, "uploads", `filled-${filename}`);
    await fs.writeFile(outputPath, buffer);
    res.download(outputPath);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error generating document" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
