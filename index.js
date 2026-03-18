const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL é obrigatória.' });
    }

    let browser = null;
    try {
        console.log(`Iniciando extração stealth para: ${url}`);
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--shm-size=1gb'
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
        });

        const page = await browser.newPage();
        
        // Simula uma tela real
        await page.setViewport({ width: 1280, height: 800 });

        // User-Agent de um Chrome moderno no Windows
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7' });

        // Navega até a URL
        console.log("Navegando...");
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });

        // Tenta clicar no botão de "Aceitar tudo" ou "Concordo" se aparecer a tela de cookies
        try {
            await new Promise(r => setTimeout(r, 4000));
            // Busca botões ou divs com papel de botão que tenham textos de aceitação
            const acceptSelectors = ['button', 'div[role="button"]', 'span', 'a'];
            const acceptTexts = /Aceitar tudo|Concordo|Concordar|Accept all|I agree|Concordo/i;
            
            const elements = await page.$$(acceptSelectors.join(','));
            for (const el of elements) {
                const text = await page.evaluate(node => node.innerText, el);
                if (acceptTexts.test(text)) {
                    console.log(`Botão de cookies encontrado: "${text}". Clicando...`);
                    await el.click();
                    await new Promise(r => setTimeout(r, 5000)); // Espera mais tempo para o redirect
                    break;
                }
            }
        } catch (e) {
            console.log("Fluxo de cookies finalizado.");
        }

        // Aguarda o título da página mudar de uma URL para um texto real (ou timeout)
        let retriesTitle = 10;
        while (retriesTitle > 0) {
            const currentTitle = await page.title();
            if (currentTitle && !currentTitle.startsWith('http') && !currentTitle.includes('google.com/search')) {
                break;
            }
            console.log(`Aguardando título real... Atual: "${currentTitle}"`);
            await new Promise(r => setTimeout(r, 1500));
            retriesTitle--;
        }

        console.log(`Página Final: "${await page.title()}" em ${await page.url()}`);
        console.log("Extraindo dados...");

        const extrair = async () => {
            return await page.evaluate(() => {
                const getTexto = (sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : null;
                };

                // 1. Extrair Nome
                let nomeExtraido = getTexto('[data-attrid="title"]') || 
                                   getTexto('h1.fontHeadlineLarge') || 
                                   getTexto('h1');

                // Filtrar "Links de acessibilidade" ou similares
                if (nomeExtraido && (nomeExtraido.toLowerCase().includes('acessibilidade') || nomeExtraido.toLowerCase().includes('accessibility'))) {
                    nomeExtraido = getTexto('[data-attrid="title"]') || getTexto('div[role="main"] h2');
                }

                if (!nomeExtraido || nomeExtraido.length < 3) {
                    nomeExtraido = document.title.replace(/ - Google (Maps|Search|Busca)/i, '')
                                                 .replace(/ – Google (Maps|Search|Busca)/i, '')
                                                 .trim();
                }

                if (nomeExtraido && (nomeExtraido.startsWith('http') || nomeExtraido.includes('google.com'))) {
                    nomeExtraido = null;
                }

                // 2. Extrair Nota e Avaliações
                let nota = null, avaliacoes = null, categoria = null;

                // SEARCH / KNOWLEDGE PANEL (Prioridade para os dados que o subagent achou)
                const searchNota = getTexto('span.Aq14f') || getTexto('.TT9eCd') || getTexto('[data-attrid="rating"] span[aria-label^="Avaliação"]');
                if (searchNota) nota = searchNota.replace(',', '.');

                const searchAval = getTexto('[data-attrid="rating"] a span') || 
                                   getTexto('.SJmY2b span') || 
                                   getTexto('.hqS69 span') ||
                                   getTexto('span[aria-label*="avaliações"]');
                if (searchAval) avaliacoes = searchAval.replace(/\D/g, '');

                const searchCat = getTexto('[data-attrid="subtitle"]') || 
                                   getTexto('.Y6Y31') || 
                                   getTexto('.E54Xyc') || 
                                   getTexto('.iP6Xbe');
                if (searchCat) categoria = searchCat.trim();

                // FALLBACK MAPS (Se os de Search falharem)
                if (!nota) {
                    const notaEl = document.querySelector('span[aria-hidden="true"]');
                    if (notaEl && notaEl.innerText.includes(',')) {
                        const possivelNota = notaEl.innerText.replace(',', '.');
                        if (!isNaN(parseFloat(possivelNota))) nota = possivelNota;
                    }
                }

                if (!avaliacoes) {
                    const avalEl = document.querySelector('button[jsaction*="pane.rating.moreReviews"]') || 
                                   document.querySelector('span[aria-label*="avaliações"]') ||
                                   document.querySelector('button[aria-label*="avaliações"]');
                    if (avalEl) {
                        avaliacoes = (avalEl.getAttribute('aria-label') || avalEl.innerText).replace(/\D/g, '');
                    }
                }

                if (!categoria) {
                    const catEl = document.querySelector('button[jsaction*="category"]') || document.querySelector('.DkEaL');
                    if (catEl) categoria = catEl.innerText.trim();
                }

                return {
                    nome: nomeExtraido,
                    nota: nota ? parseFloat(nota) : null,
                    avaliacoes: avaliacoes ? parseInt(avaliacoes, 10) : null,
                    categoria: categoria
                };
            });
        };

        let result = await extrair();

        // Se falhou (veio null), tenta esperar mais 3 segundos e extrair de novo
        if (!result.nome && !result.nota) {
            console.log("Extração falhou inicialmente. Tentando retry em 4s...");
            await new Promise(r => setTimeout(r, 4000));
            result = await extrair();
        }

        res.json({ success: true, data: result });

    } catch (error) {
        console.error("Erro no scraping:", error);
        res.status(500).json({ error: 'Erro ao extrair informações da página.', detalhe: error.message });
    } finally {
        if (browser) {
            console.log("Fechando navegador para liberar memória...");
            await browser.close();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Servidor de Scraping Escutando na porta ${PORT}`);
});
