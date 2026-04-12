module.exports = async function handler(req, res) {
  try {
    const SHEET_ID = "1wkvGNkWsTdSXj7Ihn0pIm1iHMxGau7KgMo73SlXzMB8";
    const API_KEY = "AIzaSyAS3R46KHbPb8wivtGzhWSmiihn1gGBcXM";
    const range = "2025-atp-season!E:F";

    const url =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      SHEET_ID +
      "/values/" +
      encodeURIComponent(range) +
      "?key=" +
      API_KEY;

    const response = await fetch(url);
    const text = await response.text();

    return res.status(200).json({
      ok: response.ok,
      status: response.status,
      url,
      body: text
    });
  } catch (err) {
    return res.status(200).json({
      crash: true,
      message: err.message,
      stack: err.stack
    });
  }
};