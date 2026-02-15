export function computeAnalytics(reports) {
  const stats = {
    total: reports.length,
    resolved: 0,
    rooms: {}
  };

  reports.forEach(r => {
    if (r.status === "resolved") stats.resolved++;
    stats.rooms[r.room] = (stats.rooms[r.room] || 0) + 1;
  });

  return {
    ...stats,
    open: stats.total - stats.resolved,
    mostFaultyRoom: Object.entries(stats.rooms).sort((a,b)=>b[1]-a[1])[0]
  };
}
