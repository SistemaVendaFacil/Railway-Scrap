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
        
        // --- BYPASS DE IDENTIDADE: DISFARCE MOBILE (iPhone) ---
        // Muitos bloqueios de Data Center (Railway) são menos agressivos com dispositivos móveis
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
        
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        });

        console.log("Navegando... (Modo Mobile)");
        
        // Esperamos um pouco mais para garantir que o redirecionamento e o JS rodaram
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Aguarda um pouco extra para o dinamismo do Google
        await new Promise(r => setTimeout(r, 5000));

        // Verificação de Bloqueio / Conteúdo Vazio
        const bodyHandle = await page.$('body');
        const bodyText = await page.evaluate(el => el.innerText, bodyHandle);
        
        if (bodyText.includes('unusual traffic') || bodyText.includes('/sorry/')) {
            console.error("BLOQUEIO: Captcha detectado.");
            return res.json({ success: false, error: 'IP Bloqueado (Captcha).' });
        }

        const extrair = async () => {
            return await page.evaluate(() => {
                const getTexto = (sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : null;
                };

                // Busca Nome (Vários padrões Mobile)
                let nome = getTexto('div[role="heading"][aria-level="2"]') || 
                           getTexto('h1') ||
                           getTexto('[data-attrid="title"]') ||
                           getTexto('.qrShbc div') ||
                           getTexto('.vk_bk'); // Nome em alguns layouts mobile

                // Nota
                let nota = getTexto('span.Aq14f') || 
                           getTexto('.p_z89_nota') || 
                           getTexto('.v7vB6e') || // Outro padrão mobile
                           getTexto('.h1B8Eb');

                // Avaliações
                let avaliacoes = getTexto('span.hq99nb') || 
                                 getTexto('span[aria-label*="avaliações"]') ||
                                 getTexto('.z1asCe + span') ||
                                 getTexto('.R9S7He');

                // Categoria
                let categoria = getTexto('div.BNeawe.tAd7Pd.AP7Wnd') || 
                                getTexto('[data-attrid="subtitle"]') ||
                                getTexto('.E54Xyc');

                return {
                    nome,
                    nota: nota ? nota.replace(',', '.') : null,
                    avaliacoes: avaliacoes ? avaliacoes.replace(/\D/g, '') : null,
                    categoria
                };
            });
        };

        const result = await extrair();
        
        // Tratamento de tipos
        if (result.nota) result.nota = parseFloat(result.nota);
        if (result.avaliacoes) result.avaliacoes = parseInt(result.avaliacoes, 10);

        // Se falhou gravemente, logamos o que o robô está vendo para depurar
        if (!result.nome && !result.nota) {
            const pageTitle = await page.title();
            const bodySnippet = bodyText.substring(0, 500).replace(/\n/g, ' ');
            console.log(`FALHA EXTRAÇÃO! Título: "${pageTitle}" | Snippet: ${bodySnippet}...`);
            
            // Tenta pegar o nome pelo título como última chance
            if (pageTitle && !pageTitle.startsWith('http')) {
                result.nome = pageTitle.replace(/ - Google (Busca|Search|Maps|Pesquisa)/i, '').trim();
            }
        }

        console.log("Resultado final (Mobile):", result);
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
