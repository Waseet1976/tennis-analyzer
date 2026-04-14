'use strict';
console.log('🔥 REPORT FILE LOADED:', __filename);

function generateReport(p1, p2, s1, s2, detailsA1, detailsA2, surface, tournament, dataSource1, dataSource2) {
  const total1 = s1.TOTAL || 0;
  const total2 = s2.TOTAL || 0;
  const gap    = Math.abs(total1 - total2);
  const winner = total1 >= total2 ? p1 : p2;

  let confiance, niveauConfiance;
  if      (gap > 25) { confiance = '🔥🔥🔥 Très haute confiance'; niveauConfiance = 3; }
  else if (gap > 15) { confiance = '🔥🔥 Haute confiance';        niveauConfiance = 2; }
  else if (gap > 5)  { confiance = '🔥 Confiance modérée';        niveauConfiance = 1; }
  else               { confiance = '⚡ Match imprévisible';        niveauConfiance = 0; }

 console.log('🧪 REPORT DETAILS INPUT', detailsA1, detailsA2);

  return {
    match:   { joueur1: p1, joueur2: p2, surface, tournoi: tournament },
   scoreA: {
  joueur1: {
    total: s1.A || 0,
    details: Array.isArray(detailsA1) ? detailsA1 : (detailsA1 ? [detailsA1] : [])
  },
  joueur2: {
    total: s2.A || 0,
    details: Array.isArray(detailsA2) ? detailsA2 : (detailsA2 ? [detailsA2] : [])
  }
},



    scores: {
      joueur1: { A:s1.A??null, B:s1.B??null, C:s1.C??null, D:s1.D??null,
                 E:s1.E??null, F:s1.F??null, G:s1.G??null, H:s1.H??null,
                 I:s1.I??null, J:s1.J??null, K:s1.K??null, L:s1.L??null,
                 M:s1.M??null, N:s1.N??null, O:s1.O??null, TOTAL:total1 },
      joueur2: { A:s2.A??null, B:s2.B??null, C:s2.C??null, D:s2.D??null,
                 E:s2.E??null, F:s2.F??null, G:s2.G??null, H:s2.H??null,
                 I:s2.I??null, J:s2.J??null, K:s2.K??null, L:s2.L??null,
                 M:s2.M??null, N:s2.N??null, O:s2.O??null, TOTAL:total2 }
    },
    verdict: { favori:winner, ecart:gap, confiance, niveauConfiance },
    reglesActivees: {
      joueur1: s1.notes || [],
      joueur2: s2.notes || []
    },
    dataSource: {
      joueur1: dataSource1 || {},
      joueur2: dataSource2 || {}
    }
  };
}

module.exports = { generateReport };
