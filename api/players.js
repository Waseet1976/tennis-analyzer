module.exports = async function handler(req, res) {
  const q = (req.query.q ?? '').toLowerCase().trim();

  if (q.length < 2) {
    return res.status(200).json([]);
  }

  return res.status(200).json([
    "TEST PLAYER 1",
    "TEST PLAYER 2",
    "Lehecka J.",
    "Tabilo A."
  ]);
};