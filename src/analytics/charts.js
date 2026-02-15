export function renderLineChart(ctx, labels, data) {
  return new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Fault Reports",
        data,
        borderWidth: 2,
        tension: 0.3
      }]
    }
  });
}
