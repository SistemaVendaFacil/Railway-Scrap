const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

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
        console.log(`Iniciando extração para: ${url}`);
        
        // Configurações críticas para rodar o Puppeteer em ambientes de container (como Railway) sem root
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            // Se o executável do Chrome que instalamos no Docker estiver no path, o Puppeteer vai usar.
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome'
        });

        const page = await browser.newPage();
        
        // Define um User-Agent real e Idioma fixo para evitar variações de seletores
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7' });

        // Navega até a URL
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

        // Tenta clicar no botão de "Aceitar tudo" ou "Concordo" se aparecer a tela de cookies
        try {
            const cookieButtons = await page.$$('button');
            for (let btn of cookieButtons) {
                const text = await page.evaluate(el => el.innerText, btn);
                if (text.includes('Aceitar tudo') || text.includes('Concordar') || text.includes('Accept all') || text.includes('I agree')) {
                    await btn.click();
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
                    break;
                }
            }
        } catch (e) {
            console.log("Tela de cookies não detectada ou erro ao clicar.");
        }

        console.log("Página carregada, extraindo dados...");

        const dadosExtraidos = await page.evaluate(() => {
            const getTexto = (sel) => {
                const el = document.querySelector(sel);
                return el ? el.innerText.trim() : null;
            };

            // 1. Extrair Nome
            // Tenta seletores do Maps, depois do Search (Knowledge Panel), depois o Title
            let nomeLoja = getTexto('h1.fontHeadlineLarge') || 
                           getTexto('h1') || 
                           getTexto('[data-attrid="title"]') || 
                           getTexto('div[role="main"] h2') ||
                           document.title.split(' - ')[0].split(' – ')[0];

            // 2. Extrair Nota e Avaliações
            let nota = null;
            let avaliacoes = null;
            let categoria = null;

            // --- Estrutura GOOGLE MAPS ---
            const notaEl = document.querySelector('span[aria-hidden="true"]');
            if (notaEl && notaEl.innerText.includes(',')) {
                const possivelNota = notaEl.innerText.replace(',', '.');
                if (!isNaN(parseFloat(possivelNota))) nota = possivelNota;
            }

            const avalEl = document.querySelector('button[jsaction*="pane.rating.moreReviews"]') || 
                           document.querySelector('span[aria-label*="avaliações"]') ||
                           document.querySelector('span[aria-label*="reviews"]');
            
            if (avalEl) {
                const txt = (avalEl.getAttribute('aria-label') || avalEl.innerText).replace(/\D/g, '');
                if (txt) avaliacoes = txt;
            }

            const catEl = document.querySelector('button[jsaction*="category"]') || 
                           document.querySelector('.DkEaL') ||
                           document.querySelector('.fontBodyMedium span');
            if (catEl) {
                categoria = catEl.innerText.trim();
            }

            // --- Estrutura GOOGLE SEARCH (Knowledge Panel) ---
            if (!nota) {
                const searchNota = getTexto('span.Aq14f') || getTexto('.TT9eCd');
                if (searchNota) nota = searchNota.replace(',', '.');
            }
            if (!avaliacoes) {
                const searchAval = getTexto('.SJmY2b span') || getTexto('.z1asCe + span');
                if (searchAval) avaliacoes = searchAval.replace(/\D/g, '');
            }
            if (!categoria) {
                categoria = getTexto('.Y6Y31') || getTexto('.E54Xyc');
            }

            // 4. Fallback agressivo por Regex se nada acima funcionou
            if (!nota || !avaliacoes) {
                const bodyText = document.body.innerText;
                const matchNota = bodyText.match(/(\d[.,]\d)\s?estrelas/i);
                if (matchNota && !nota) nota = matchNota[1].replace(',', '.');

                const matchAval = bodyText.match(/([\d.]+)\s?avalia/i);
                if (matchAval && !avaliacoes) avaliacoes = matchAval[1].replace(/\D/g, '');
            }

            return {
                nome: nomeLoja,
                nota: nota ? parseFloat(nota) : null,
                avaliacoes: avaliacoes ? parseInt(avaliacoes, 10) : null,
                categoria: categoria
            };
        });

        console.log("Extração concluída:", dadosExtraidos);

        res.json({ success: true, data: dadosExtraidos });
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
