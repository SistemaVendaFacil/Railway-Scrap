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
        
        // Define um User-Agent real
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navega até a URL aguardando o carregamento da rede parar (pra driblar redirecionamentos)
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        console.log("Página carregada, extraindo dados...");

        const dadosExtraidos = await page.evaluate(() => {
            const getTexto = (sel) => {
                const el = document.querySelector(sel);
                return el ? el.innerText.trim() : null;
            };

            // 1. Extrair Nome
            let nome = getTexto('h1.fontHeadlineLarge') || getTexto('h1') || document.title.replace(' - Google Maps', '');

            // 2. Extrair Nota e Avaliações (Método Visual/DOM primeiro)
            let nota = null;
            let avaliacoes = null;
            let categoria = null;

            // Busca a nota em spans de estrelas (ex: "4,8")
            const notaEl = document.querySelector('span[aria-hidden="true"]');
            if (notaEl && notaEl.innerText.includes(',')) {
                nota = notaEl.innerText.replace(',', '.');
            }

            // Busca avaliações (ex: "(1.592)" ou "1.592 avaliações")
            const avalEl = document.querySelector('button[jsaction="pane.rating.moreReviews"] span') || 
                           document.querySelector('span[aria-label*="avaliações"]');
            if (avalEl) {
                avaliacoes = avalEl.innerText.replace(/\D/g, '');
            }

            // 3. Extrair Categoria (Setor)
            // Geralmente é um botão próximo à nota
            const catEl = document.querySelector('button[jsaction*="category"]') || 
                           document.querySelector('.DkEaL'); // Classe comum para categoria no Maps
            if (catEl) {
                categoria = catEl.innerText.trim();
            }

            // 4. Fallback para Texto Puro se a estrutura falhar
            const textoBody = document.body.innerText;
            if (!nota || !avaliacoes) {
                const regex = /(\d[.,]\d)[^\d]{1,10}?(\d+([.,]\d+)*)[^\d]{1,10}?(avalia|coment)/i;
                const match = textoBody.match(regex);
                if (match) {
                    if (!nota) nota = match[1].replace(',', '.');
                    if (!avaliacoes) avaliacoes = match[2].replace(/\D/g, '');
                }
            }

            return {
                nome: nome,
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
