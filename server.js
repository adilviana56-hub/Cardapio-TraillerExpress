const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg'); // Conexão com o Supabase (PostgreSQL)

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configuração do PostgreSQL / Supabase via Variável de Ambiente
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Inicializa a tabela 'pedidos' e 'cardapio' no banco de dados se elas ainda não existirem
async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.log("⚠️ Variável DATABASE_URL não encontrada no ambiente. Verifique o Render.");
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id BIGINT PRIMARY KEY,
        cliente VARCHAR(255),
        whatsapp VARCHAR(50),
        subtotal NUMERIC(10,2),
        taxa_entrega NUMERIC(10,2),
        total NUMERIC(10,2),
        tipo_entrega VARCHAR(50),
        endereco TEXT,
        pagamento VARCHAR(50),
        troco VARCHAR(50),
        observacao TEXT,
        status VARCHAR(50),
        itens JSONB,
        data_criacao TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cardapio (
        id SERIAL PRIMARY KEY,
        categoria VARCHAR(255) NOT NULL,
        produtos JSONB NOT NULL
      );
    `);

    console.log("🟢 Conectado ao Supabase (PostgreSQL) e tabelas prontas!");
    
    // Carrega o cardápio do banco após inicializar
    dadosCardapio = await carregarCardapioDoBanco();

  } catch (err) {
    console.error("🔴 Erro ao inicializar o banco de dados no Supabase:", err);
    dadosCardapio = carregarCardapio();
  }
}
initDb();

// Caminhos dos arquivos de dados persistentes
const DATA_FILE = path.join(__dirname, 'cardapio.json');
const PEDIDOS_FILE = path.join(__dirname, 'pedidos.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Configurações padrão de entrega
const DEFAULT_CONFIG = {
  lojaEndereco: "Rua Demeciano de Mattos Pereira, 3250 C - Jardim Novo Horizonte, Dourados - MS",
  lojaLat: -22.232117,
  lojaLng: -54.845952,
  taxaBase: 5.50,
  valorPorKm: 1.30,
  distanciaMaximaKm: 20,
  lojaAberta: true
};

function carregarConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch (err) {
      console.error("Erro ao ler config.json, usando padrão:", err);
    }
  }
  return DEFAULT_CONFIG;
}

function salvarConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configLoja, null, 2), 'utf8');
  } catch (err) {
    console.error("Erro ao salvar config.json:", err);
  }
}

let configLoja = carregarConfig();

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c * 1.30;
}

function calcularTaxaEntrega(clienteLat, clienteLng, formaPagamento = '') {
  if (!clienteLat || !clienteLng) {
    return { erro: "Coordenadas do cliente não informadas." };
  }

  const distanciaKm = calcularDistanciaKm(configLoja.lojaLat, configLoja.lojaLng, clienteLat, clienteLng);

  if (distanciaKm > configLoja.distanciaMaximaKm) {
    return { 
      entregavel: false, 
      distanciaKm: parseFloat(distanciaKm.toFixed(2)),
      mensagem: `Endereço fora da área de entrega (Máximo ${configLoja.distanciaMaximaKm} km).` 
    };
  }

  let taxaCalculada = configLoja.taxaBase + (distanciaKm * configLoja.valorPorKm);

  const pagamentoStr = String(formaPagamento).toLowerCase();
  const pagamentoCartao = pagamentoStr.includes('cartao') || 
                         pagamentoStr.includes('cartão') ||
                         pagamentoStr.includes('debito') ||
                         pagamentoStr.includes('débito') ||
                         pagamentoStr.includes('credito') ||
                         pagamentoStr.includes('crédito');

  if (pagamentoCartao) {
    taxaCalculada += 2.00;
  }

  return {
    entregavel: true,
    distanciaKm: parseFloat(distanciaKm.toFixed(2)),
    taxaEntrega: parseFloat(taxaCalculada.toFixed(2)),
    taxaCartaoAplicada: pagamentoCartao
  };
}

// Normaliza a lista de produtos garantindo que sempre seja 'produtos'
function normalizarCardapio(cardapio) {
  if (!Array.isArray(cardapio)) return [];
  return cardapio.map(cat => {
    const lista = cat.produtos || cat.itens || [];
    return {
      categoria: cat.categoria || "Geral",
      produtos: lista.map(p => ({
        ...p,
        ativo: p.ativo !== undefined ? p.ativo : (p.disponivel !== undefined ? p.disponivel : true),
        disponivel: p.disponivel !== undefined ? p.disponivel : (p.ativo !== undefined ? p.ativo : true)
      }))
    };
  });
}

function carregarCardapio() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return normalizarCardapio(parsed);
      }
    } catch (err) {
      console.error("Erro ao ler cardapio.json, usando padrão:", err);
    }
  }
  return [
    {
      categoria: "Lanches",
      produtos: [
        { id: 1, nome: "Hambúrguer 150g", descricao: "Carne artesanal grelhada na hora.", preco: 12.00, ativo: true, disponivel: true },
        { id: 2, nome: "Bacon Crocante", descricao: "Porção de bacon em fatias.", preco: 5.00, ativo: true, disponivel: true }
      ]
    },
    {
      categoria: "Bebidas",
      produtos: [
        { id: 3, nome: "Refrigerante Lata", descricao: "Lata 350ml trincando de gelada.", preco: 6.00, ativo: true, disponivel: true }
      ]
    }
  ];
}

// Função assíncrona para carregar o cardápio do Supabase
async function carregarCardapioDoBanco() {
  if (!process.env.DATABASE_URL) {
    return carregarCardapio();
  }

  try {
    const res = await pool.query('SELECT categoria, produtos FROM cardapio ORDER BY id ASC');
    if (res.rows.length > 0) {
      const cardapioFormatado = res.rows.map(row => ({
        categoria: row.categoria,
        produtos: row.produtos
      }));
      return normalizarCardapio(cardapioFormatado);
    }
  } catch (err) {
    console.error("Erro ao carregar cardápio do Supabase:", err);
  }

  return carregarCardapio();
}

// Função assíncrona para salvar todo o cardápio no Supabase
async function salvarCardapioNoBanco() {
  if (!process.env.DATABASE_URL) {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(dadosCardapio, null, 2), 'utf8');
    } catch (err) {
      console.error("Erro ao salvar cardapio.json:", err);
    }
    return;
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM cardapio');
      
      for (const cat of dadosCardapio) {
        await client.query(
          'INSERT INTO cardapio (categoria, produtos) VALUES ($1, $2)',
          [cat.categoria, JSON.stringify(cat.produtos || [])]
        );
      }
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Erro ao salvar cardápio no Supabase:", err);
  }
}

function carregarPedidos() {
  if (fs.existsSync(PEDIDOS_FILE)) {
    try {
      const data = fs.readFileSync(PEDIDOS_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error("Erro ao ler pedidos.json, usando array vazio:", err);
    }
  }
  return [];
}

function salvarPedidos() {
  try {
    fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(pedidosAtivos, null, 2), 'utf8');
  } catch (err) {
    console.error("Erro ao salvar pedidos.json:", err);
  }
}

let dadosCardapio = [];
let pedidosAtivos = carregarPedidos();
let lojaAberta = configLoja.lojaAberta !== undefined ? configLoja.lojaAberta : true;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/painel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});

app.post('/api/calcular-taxa', (req, res) => {
  const { lat, lng, formaPagamento } = req.body;
  const resultado = calcularTaxaEntrega(lat, lng, formaPagamento);
  res.json(resultado);
});

io.on('connection', (socket) => {
  socket.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio, configEntrega: configLoja });
  socket.emit('carregarPedidos', pedidosAtivos);

  socket.on('calcularTaxaEntrega', (coords, callback) => {
    const lat = coords ? (coords.lat || coords.latitude) : null;
    const lng = coords ? (coords.lng || coords.longitude) : null;
    const formaPagamento = coords ? (coords.formaPagamento || '') : '';

    const resultado = calcularTaxaEntrega(lat, lng, formaPagamento);

    if (typeof callback === 'function') {
      callback(resultado);
    } else {
      socket.emit('resultadoTaxaEntrega', resultado);
    }
  });

  socket.on('atualizarConfigEntrega', (novasConfigs) => {
    configLoja = { ...configLoja, ...novasConfigs };
    salvarConfig();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio, configEntrega: configLoja });
  });

  socket.on('mudarStatusLoja', (status) => {
    lojaAberta = status;
    configLoja.lojaAberta = status;
    salvarConfig();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('mudarStatusProduto', async ({ idProduto, disponivel }) => {
    dadosCardapio.forEach(cat => {
      const lista = cat.produtos || cat.itens || [];
      const prod = lista.find(p => p.id === idProduto);
      if (prod) {
        prod.ativo = disponivel;
        prod.disponivel = disponivel;
      }
    });
    await salvarCardapioNoBanco();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('editarProduto', async ({ idProduto, nome, preco, descricao }) => {
    dadosCardapio.forEach(cat => {
      const lista = cat.produtos || cat.itens || [];
      const prod = lista.find(p => p.id === idProduto);
      if (prod) {
        if (nome) prod.nome = nome.trim();
        if (preco !== undefined && !isNaN(preco)) prod.preco = parseFloat(preco);
        if (descricao !== undefined) prod.descricao = descricao.trim();
        if (prod.ativo === undefined) prod.ativo = true;
        if (prod.disponivel === undefined) prod.disponivel = true;
      }
    });
    await salvarCardapioNoBanco();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('excluirProduto', async (idProduto) => {
    dadosCardapio.forEach(cat => {
      if (cat.produtos) cat.produtos = cat.produtos.filter(p => p.id !== idProduto);
      if (cat.itens) cat.itens = cat.itens.filter(p => p.id !== idProduto);
    });
    await salvarCardapioNoBanco();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('adicionarCategoria', async (nomeCategoria) => {
    const nomeLimpo = nomeCategoria.trim();
    if (nomeLimpo !== "") {
      const existe = dadosCardapio.some(c => c.categoria.toLowerCase() === nomeLimpo.toLowerCase());
      if (!existe) {
        dadosCardapio.push({ categoria: nomeLimpo, produtos: [] });
        await salvarCardapioNoBanco();
        io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
      }
    }
  });

  socket.on('editarCategoria', async ({ nomeAntigo, novoNome }) => {
    const nomeLimpo = novoNome.trim();
    if (nomeLimpo !== "") {
      const cat = dadosCardapio.find(c => c.categoria === nomeAntigo);
      if (cat) {
        cat.categoria = nomeLimpo;
        await salvarCardapioNoBanco();
        io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
      }
    }
  });

  socket.on('excluirCategoria', async (nomeCategoria) => {
    dadosCardapio = dadosCardapio.filter(c => c.categoria !== nomeCategoria);
    await salvarCardapioNoBanco();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('adicionarProduto', async (novoProduto) => {
    const catEnviada = (novoProduto.categoria || '').trim();
    
    let cat = dadosCardapio.find(c => c.categoria.toLowerCase() === catEnviada.toLowerCase());

    if (!cat) {
      const nomeCatNova = catEnviada || "Outros";
      cat = { categoria: nomeCatNova, produtos: [] };
      dadosCardapio.push(cat);
    }

    if (!cat.produtos) cat.produtos = [];

    cat.produtos.push({
      id: Date.now(),
      nome: novoProduto.nome,
      descricao: novoProduto.descricao || '',
      preco: parseFloat(novoProduto.preco),
      ativo: true,
      disponivel: true
    });

    await salvarCardapioNoBanco();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('novoPedido', async (pedido) => {
    if (!pedido.id) pedido.id = Date.now();
    pedido.status = 'pendente';
    pedidosAtivos.unshift(pedido);
    salvarPedidos();

    // Salva o pedido no banco de dados Supabase para os relatórios
    if (process.env.DATABASE_URL) {
      try {
        await pool.query(`
          INSERT INTO pedidos (id, cliente, whatsapp, subtotal, taxa_entrega, total, tipo_entrega, endereco, pagamento, troco, observacao, status, itens)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO NOTHING
        `, [
          pedido.id,
          pedido.cliente || 'Cliente Sem Nome',
          pedido.whatsapp || null,
          pedido.subtotal || (pedido.total ? pedido.total - (pedido.taxaEntrega || 0) : 0),
          pedido.taxaEntrega || 0,
          pedido.total || 0,
          pedido.tipoEntrega || 'entrega',
          pedido.endereco || null,
          pedido.pagamento || 'não especificado',
          pedido.troco || null,
          pedido.observacao || null,
          'pendente',
          JSON.stringify(pedido.itens || [])
        ]);
      } catch (err) {
        console.error("Erro ao gravar pedido no Supabase:", err);
      }
    }

    io.emit('novoPedido', pedido);
    io.emit('atualizarListaPedidos', pedidosAtivos);
  });

  socket.on('alterarStatusPedido', async ({ id, status }) => {
    const pedido = pedidosAtivos.find(p => p.id === id);
    if (pedido) {
      pedido.status = status;
      salvarPedidos();

      if (status === 'saiu_entrega') {
        const mensagemWhats = `Olá ${pedido.cliente || ''}! 🛵 Seu pedido #${pedido.id.toString().slice(-4)} acabou de sair para entrega!`;
        io.emit('notificacaoCliente', {
          pedidoId: id,
          status: 'saiu_entrega',
          mensagem: mensagemWhats
        });
      }

      io.emit('atualizarListaPedidos', pedidosAtivos);
    }

    // Atualiza o status no banco de dados do Supabase
    if (process.env.DATABASE_URL) {
      try {
        await pool.query('UPDATE pedidos SET status = $1 WHERE id = $2', [status, id]);
      } catch (err) {
        console.error("Erro ao atualizar status do pedido no Supabase:", err);
      }
    }
  });

  socket.on('removerPedido', (idPedido) => {
    pedidosAtivos = pedidosAtivos.filter(p => p.id !== idPedido);
    salvarPedidos();
    io.emit('atualizarListaPedidos', pedidosAtivos);
  });

  // EXCLUIR VENDA DO HISTÓRICO FINANCEIRO (SUPABASE)
  socket.on('excluirVendaHistorico', async (id) => {
    if (!process.env.DATABASE_URL) return;

    try {
      await pool.query('DELETE FROM pedidos WHERE id = $1', [id]);
    } catch (err) {
      console.error("Erro ao excluir venda do histórico no Supabase:", err);
    }
  });

  // IMPRESSÃO INDIVIDUAL DE VENDA DO HISTÓRICO (SUPABASE)
  socket.on('imprimirVendaHistorico', async (id) => {
    if (!process.env.DATABASE_URL) return;

    try {
      // Modificado para aceitar tanto o ID inteiro exato quanto uma busca por final de ID caso venha cortado
      let resPedido = await pool.query(`
        SELECT id, cliente, whatsapp, subtotal, taxa_entrega, total, tipo_entrega, endereco, pagamento, troco, observacao, status, itens, TO_CHAR(data_criacao, 'DD/MM/YYYY HH24:MI') as data_formatada
        FROM pedidos WHERE id = $1
      `, [id]);

      // Se não encontrar diretamente pelo ID exato, tenta buscar pelo final do ID (caso o frontend tenha enviado só os 4 dígitos)
      if (resPedido.rows.length === 0 && String(id).length <= 6) {
        resPedido = await pool.query(`
          SELECT id, cliente, whatsapp, subtotal, taxa_entrega, total, tipo_entrega, endereco, pagamento, troco, observacao, status, itens, TO_CHAR(data_criacao, 'DD/MM/YYYY HH24:MI') as data_formatada
          FROM pedidos WHERE RIGHT(CAST(id AS TEXT), 4) = $1 OR RIGHT(CAST(id AS TEXT), 5) = $1
          ORDER BY data_criacao DESC LIMIT 1
        `, [String(id).replace('#', '')]);
      }

      if (resPedido.rows.length > 0) {
        const pedidoEncontrado = resPedido.rows[0];
        socket.emit('executarImpressaoPedido', pedidoEncontrado);
      } else {
        socket.emit('erroImpressao', 'Pedido não encontrado no histórico.');
      }
    } catch (err) {
      console.error("Erro ao buscar pedido para impressão no Supabase:", err);
      socket.emit('erroImpressao', 'Erro interno ao buscar pedido.');
    }
  });

  // BUSCAR RELATÓRIOS FINANCEIROS DO SUPABASE
  socket.on('obterRelatorioFinanceiro', async (filtro) => {
    if (!process.env.DATABASE_URL) return;

    try {
      let queryCondicao = "WHERE status != 'cancelado'";
      
      if (filtro === 'hoje') {
        queryCondicao += " AND data_criacao >= CURRENT_DATE";
      } else if (filtro === 'semana') {
        queryCondicao += " AND data_criacao >= NOW() - INTERVAL '7 days'";
      } else if (filtro === 'mes') {
        queryCondicao += " AND data_criacao >= DATE_TRUNC('month', CURRENT_DATE)";
      }

      // 1. Resumo financeiro total
      const resTotais = await pool.query(`
        SELECT 
          COUNT(*) as qtd_pedidos,
          COALESCE(SUM(subtotal), 0) as total_produtos,
          COALESCE(SUM(taxa_entrega), 0) as total_taxas,
          COALESCE(SUM(total), 0) as faturamento_total
        FROM pedidos ${queryCondicao}
      `);

      // 2. Busca lista de pedidos do período incluindo o ID COMPLETO REAL para o botão de imprimir funcionar perfeitamente
      const resLista = await pool.query(`
        SELECT id, cliente, total, tipo_entrega, pagamento, status, TO_CHAR(data_criacao, 'DD/MM/YYYY HH24:MI') as data_formatada
        FROM pedidos ${queryCondicao}
        ORDER BY data_criacao DESC
        LIMIT 50
      `);

      socket.emit('respostaRelatorioFinanceiro', {
        resumo: resTotais.rows[0],
        pedidos: resLista.rows
      });
    } catch (err) {
      console.error("Erro ao obter relatório financeiro do Supabase:", err);
    }
  });
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
  console.log(`Servidor rodando com sucesso na porta ${PORTA}`);
});
