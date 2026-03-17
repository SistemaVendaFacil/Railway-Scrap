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
            let nomeStr = null;
            let notaStr = null;
            let avaliacoesStr = null;
            let categoriaStr = null;

            // Extrair Nome (geralmente num h1 em páginas de mapa/busca)
            const h1 = document.querySelector('h1');
            if (h1) nomeStr = h1.innerText.trim();

            // Pega o texto completo da tela para procurar o padrão de avaliação em pt-BR
            const textoCompleto = document.body.innerText || "";
            
            // Regex ajustada: Pega a nota (ex: 4,8), e as avaliações (ex: 34)
            const regexAvaliacao = /(\d[.,]\d)[^\d]{1,10}?(\d+([.,]\d+)*)[^\d]{1,10}?(avalia|coment)/i;
            const match = textoCompleto.match(regexAvaliacao);
            
            if (match) {
                notaStr = match[1].replace(',', '.');
                avaliacoesStr = match[2].replace(/[.,]/g, ''); // Limpa os pontos (1.500 -> 1500)
            }

            // Tenta pegar alguma categoria/setor perto do nome ou da nota (Padrão Google Maps: "Pizzaria", "Restaurante", etc)
            // Em páginas do Maps completas, a categoria é um botão após as avaliações.
            const botoes = Array.from(document.querySelectorAll('button'));
            for(let btn of botoes) {
                 if(btn.innerText && btn.innerText.length > 3 && btn.innerText.length < 30) {
                     // Lógica muito simples para tentar adivinhar a categoria, o ideal é refinar com o CSS real do Google que mudar toda hora
                     let classname = btn.className.toLowerCase();
                     if(classname.includes('category') || btn.getAttribute('aria-label')?.toLowerCase().includes('categoria')) {
                         categoriaStr = btn.innerText;
                         break;
                     }
                 }
            }

            return {
                nome: nomeStr,
                nota: notaStr ? parseFloat(notaStr) : null,
                avaliacoes: avaliacoesStr ? parseInt(avaliacoesStr, 10) : null,
                categoria: categoriaStr
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
