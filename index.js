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
        
        // Esperamos apenas o DOM carregar (menos barulhento que networkidle2)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Verificação rápida de Bloqueio
        const pageContent = await page.content();
        if (pageContent.includes('unusual traffic') || pageContent.includes('/sorry/')) {
            console.error("BLOQUEIO PERSISTENTE: O IP do Railway continua barrado pelo Google.");
            return res.json({ 
                success: false, 
                error: 'IP do Servidor Bloqueado pelo Google (Captcha).', 
                blockedIp: true 
            });
        }

        // Aguarda um pouco para o JS do Google rodar no mobile
        await new Promise(r => setTimeout(r, 4000));

        const extrair = async () => {
            return await page.evaluate(() => {
                const getTexto = (sel) => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : null;
                };

                // --- SELETORES MOBILE GOOGLE SEARCH ---
                // Nome: div de heading nível 2 é o mais estável
                let nome = getTexto('div[role="heading"][aria-level="2"]') || 
                           getTexto('h1') ||
                           getTexto('[data-attrid="title"]');

                // Nota: classe Aq14f é padrão no mobile
                let nota = getTexto('span.Aq14f') || getTexto('.p_z89_nota');
                
                // Avaliações: span hq99nb ou aria-label
                let avaliacoes = getTexto('span.hq99nb') || 
                                 getTexto('span[aria-label*="avaliações"]');
                
                // Categoria: Bloco de texto após a nota
                let categoria = getTexto('div.BNeawe.tAd7Pd.AP7Wnd') || 
                                getTexto('[data-attrid="subtitle"]');

                // --- FALLBACKS ---
                if (nome && /acessibilidade|accessibility|google/i.test(nome)) nome = null;
                if (nota && nota.includes(',')) nota = nota.replace(',', '.');
                if (avaliacoes) avaliacoes = avaliacoes.replace(/\D/g, '');

                return {
                    nome: nome,
                    nota: nota ? parseFloat(nota) : null,
                    avaliacoes: avaliacoes ? parseInt(avaliacoes, 10) : null,
                    categoria: categoria
                };
            });
        };

        const result = await extrair();
        
        // SEGURANÇA FINAL: Se o nome falhou ou veio URL, tenta o título da aba se for limpo
        if (!result.nome || result.nome.startsWith('http')) {
            const title = await page.title();
            if (title && !title.startsWith('http')) {
                result.nome = title.replace(/ - Google (Busca|Search|Maps|Pesquisa)/i, '').trim();
            } else {
                result.nome = null; // Antes nulo que URL
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
