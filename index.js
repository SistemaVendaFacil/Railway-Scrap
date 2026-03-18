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
        
        // Simulação de comportamento mais humano
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'DNT': '1'
        });

        console.log("Navegando até a URL...");
        
        // Vai para o Google principal primeiro para criar um "contexto" (opcional, mas às vezes ajuda)
        // await page.goto('https://www.google.com.br', { waitUntil: 'networkidle2' });
        
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Verificação de CAPTCHA
        const isCaptcha = await page.evaluate(() => {
            return document.title.includes('Pardon') || 
                   document.body.innerText.includes('unusual traffic') ||
                   location.href.includes('/sorry/');
        });

        if (isCaptcha) {
            console.error("BLOQUEIO DETECTADO: Captcha do Google exibido.");
            await browser.close();
            return res.json({ success: false, error: 'Google bloqueou o acesso (Captcha).', isBotBlocked: true });
        }

        // Tenta aceitar cookies se aparecer
        try {
            const cookieTexts = /Aceitar tudo|Concordo|Agree|Accept all/i;
            const buttons = await page.$$('button, div[role="button"]');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.innerText, btn);
                if (cookieTexts.test(text)) {
                    await btn.click();
                    await new Promise(r => setTimeout(r, 3000));
                    break;
                }
            }
        } catch (e) {}

        // Aguarda os dados aparecerem (Knowledge Panel ou Maps)
        let foundData = false;
        let retries = 15;
        while (retries > 0 && !foundData) {
            foundData = await page.evaluate(() => {
                return !!(document.querySelector('[data-attrid="title"]') || 
                          document.querySelector('h1.fontHeadlineLarge') ||
                          document.querySelector('.LrzUbe') ||
                          document.querySelector('span.Aq14f'));
            });
            if (!foundData) {
                console.log(`Aguardando dados... (${retries})`);
                await new Promise(r => setTimeout(r, 2000));
                retries--;
            } else {
                break;
            }
        }

        console.log(`Página Estável. Título: "${await page.title()}"`);

        const extrair = async () => {
            return await page.evaluate(() => {
                const getTexto = (sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : null;
                };

                // 1. Extrair Nome (Evitando textos de acessibilidade)
                let nome = getTexto('[data-attrid="title"]') || 
                           getTexto('h1.fontHeadlineLarge') || 
                           getTexto('.LrzUbe') ||
                           getTexto('h1');

                if (nome && /acessibilidade|accessibility/i.test(nome)) {
                    nome = document.title.replace(/ - Google (Maps|Search|Pesquisa)/i, '').trim();
                }

                if (nome && (nome.startsWith('http') || nome.includes('google.com'))) {
                    nome = null;
                }

                // 2. Extrair Nota e Avaliações
                let nota = null, avaliacoes = null, categoria = null;

                // Seletores unificados (Geral + Maps)
                const sNota = getTexto('span.Aq14f') || 
                               getTexto('.TT9eCd') || 
                               getTexto('[aria-hidden="true"]');
                if (sNota && sNota.includes(',')) nota = sNota.replace(',', '.');

                const sAval = getTexto('[data-attrid="rating"] a span') || 
                               getTexto('.SJmY2b span') || 
                               getTexto('button[jsaction*="reviews"]') ||
                               getTexto('span[aria-label*="avaliações"]');
                if (sAval) avaliacoes = sAval.replace(/\D/g, '');

                const sCat = getTexto('[data-attrid="subtitle"]') || 
                              getTexto('.Y6Y31') || 
                              getTexto('.DkEaL') ||
                              getTexto('button[jsaction*="category"]');
                if (sCat) categoria = sCat.trim();

                return {
                    nome: nome,
                    nota: nota ? parseFloat(nota) : null,
                    avaliacoes: avaliacoes ? parseInt(avaliacoes, 10) : null,
                    categoria: categoria
                };
            });
        };

        const result = await extrair();
        console.log("Resultado final:", result);

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
