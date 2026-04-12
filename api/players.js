export default async function handler(req, res) {
  const q = (req.query.q ?? '').toLowerCase().trim();

  if (q.length < 2) {
    return res.status(200).json([]);
  }

  try {
   const SHEET_ID = "1wkvGNkWsTdSXj7Ihn0pIm1iHMxGau7KgMo73SlXzMB8";
const API_KEY = "AIzaSyAS3R46KHbPb8wivtGzhWSmiihn1gGBcXM";

const range = "2025-atp-season!E:F";

const url = https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY};

const response = await fetch(url);
const data = await response.json();

const rows = data.values || [];

const namesSet = new Set();

    rows.slice(1).forEach(row => {
      if (row[0]) namesSet.add(row[0].trim());
      if (row[1]) namesSet.add(row[1].trim());
    });

    const names = Array.from(namesSet).sort();

    const filtered = names.filter(name =>
      name.toLowerCase().includes(q)
    );

    res.status(200).json(filtered.slice(0, 20));

  } catch (err) {
    console.error("API players error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
}