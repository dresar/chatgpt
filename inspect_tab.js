const CDPClient = require('./core/cdp');

async function inspectDOM() {
  const pages = await CDPClient.getActivePages();
  const target = pages.find(p => p.type === 'page' && (p.url.includes('chatgpt') || p.title.toLowerCase().includes('chatgpt')));
  const client = new CDPClient({ wsUrl: target.webSocketDebuggerUrl });
  await client.connect();
  await client.enableDomains();

  const details = await client.eval(`(() => {
    const turns = Array.from(document.querySelectorAll('[data-message-author-role], .conversation-turn, div[class*="group/conversation-turn"]')).map(el => ({
      role: el.getAttribute('data-message-author-role'),
      text: el.innerText.slice(0, 300),
      html: el.innerHTML.slice(0, 300)
    }));

    const allImages = Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src,
      alt: img.alt,
      width: img.naturalWidth,
      height: img.naturalHeight,
      classes: img.className,
      parent: img.parentElement?.tagName
    }));

    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      testId: b.getAttribute('data-testid'),
      ariaLabel: b.getAttribute('aria-label'),
      text: b.innerText
    })).filter(b => b.testId || b.ariaLabel || b.text);

    return {
      turnsCount: turns.length,
      turns,
      allImages,
      buttons: buttons.slice(0, 15)
    };
  })()`);

  console.log('DOM DETAILS:\n', JSON.stringify(details, null, 2));
  await client.close();
}

inspectDOM().catch(console.error);
