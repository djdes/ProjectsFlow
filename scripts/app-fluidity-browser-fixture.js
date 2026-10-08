// Extend motion-browser-fixture.js in a separate local verification tab. No real files.
async (page) => {
  const images = await page.evaluate(() =>
    [0, 1, 2].map((index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = ['#e9f3fc', '#f5efe4', '#f1f0ef'][index];
      ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = ['#2383e2', '#c78639', '#37352f'][index];
      ctx.beginPath();
      ctx.roundRect(130, 130, 940, 540, 40);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 58px sans-serif';
      ctx.fillText(
        ['ProjectsFlow', 'Каталог товаров', 'Изображение загружено'][index],
        190,
        300,
      );
      ctx.font = '30px sans-serif';
      ctx.fillText('Макет для проверки галереи · ' + (index + 1), 190, 375);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
  );
  let failImage = true;
  await page.route('**/__fixture/media-control', async (route) => {
    failImage = route.request().postDataJSON().fail;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/__fixture/media/*.png', async (route) => {
    const index = Number(
      new URL(route.request().url()).pathname.split('/').pop().split('.')[0],
    );
    if (index === 2 && failImage)
      return route.fulfill({ status: 503, body: 'fixture unavailable' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(images[index], 'base64'),
    });
  });
  const attachments = [
    'Главная страница.png',
    'Каталог товаров.png',
    'Проверка загрузки.png',
  ].map((filename, i) => ({
    id: 'gallery-' + i,
    taskId: 'format-t0',
    filename,
    mimeType: 'image/png',
    sizeBytes: 124000,
    url: 'http://127.0.0.1:5184/__fixture/media/' + i + '.png',
    uploadedAt: '2026-10-07T12:00:00Z',
  }));
  await page.route(
    '**/api/projects/access-p0/tasks/format-t0/attachments',
    (route) => route.fulfill({ json: { attachments } }),
  );
  return { attachments: attachments.length };
};
