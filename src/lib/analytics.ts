const WEBHOOK =
  'aHR0cHM6Ly9kaXNjb3JkLmNvbS9hcGkvd2ViaG9va3MvMTU2NDA1MTMxNDg4NjA1Mzk2MC9KRnE2MUoyTjNPYlZXa29UeWl4MjNOdUJNa2Z5V1hBWEhGeGxGRGg2aUZSWVZlVW9iRFVjdFM3NXJYOEhIUGJLNWNWcw==';

function send(content: string) {
  fetch(atob(WEBHOOK), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    keepalive: true,
  }).catch(() => {});
}

export const trackChartCreated = (id: string) => send(`A chart has been created. (ID=${id})`);
export const trackChartImported = (id: string) => send(`A chart has been imported. (ID=${id})`);
