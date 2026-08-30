const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
  distanciaMaximaKm: 20
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
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
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

function salvarCardapio() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(dadosCardapio, null, 2), 'utf8');
  } catch (err) {
    console.error("Erro ao salvar cardapio.json:", err);
  }
}

function salvarPedidos() {
  try {
    fs.writeFileSync(PEDIDOS_FILE, JSON.stringify(pedidosAtivos, null, 2), 'utf8');
  } catch (err) {
    console.error("Erro ao salvar pedidos.json:", err);
  }
}

let dadosCardapio = carregarCardapio();
let pedidosAtivos = carregarPedidos();
let lojaAberta = true;

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
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('mudarStatusProduto', ({ idProduto, disponivel }) => {
    dadosCardapio.forEach(cat => {
      const lista = cat.produtos || cat.itens || [];
      const prod = lista.find(p => p.id === idProduto);
      if (prod) {
        prod.ativo = disponivel;
        prod.disponivel = disponivel;
      }
    });
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('editarProduto', ({ idProduto, nome, preco, descricao }) => {
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
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('excluirProduto', (idProduto) => {
    dadosCardapio.forEach(cat => {
      if (cat.produtos) cat.produtos = cat.produtos.filter(p => p.id !== idProduto);
      if (cat.itens) cat.itens = cat.itens.filter(p => p.id !== idProduto);
    });
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('adicionarCategoria', (nomeCategoria) => {
    const nomeLimpo = nomeCategoria.trim();
    if (nomeLimpo !== "") {
      const existe = dadosCardapio.some(c => c.categoria.toLowerCase() === nomeLimpo.toLowerCase());
      if (!existe) {
        dadosCardapio.push({ categoria: nomeLimpo, produtos: [] });
        salvarCardapio();
        io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
      }
    }
  });

  socket.on('editarCategoria', ({ nomeAntigo, novoNome }) => {
    const nomeLimpo = novoNome.trim();
    if (nomeLimpo !== "") {
      const cat = dadosCardapio.find(c => c.categoria === nomeAntigo);
      if (cat) {
        cat.categoria = nomeLimpo;
        salvarCardapio();
        io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
      }
    }
  });

  socket.on('excluirCategoria', (nomeCategoria) => {
    dadosCardapio = dadosCardapio.filter(c => c.categoria !== nomeCategoria);
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('adicionarProduto', (novoProduto) => {
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

    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  socket.on('novoPedido', (pedido) => {
    if (!pedido.id) pedido.id = Date.now();
    pedido.status = 'pendente';
    pedidosAtivos.unshift(pedido);
    salvarPedidos();

    io.emit('novoPedido', pedido);
    io.emit('atualizarListaPedidos', pedidosAtivos);
  });

  socket.on('alterarStatusPedido', ({ id, status }) => {
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
  });

  socket.on('removerPedido', (idPedido) => {
    pedidosAtivos = pedidosAtivos.filter(p => p.id !== idPedido);
    salvarPedidos();
    io.emit('atualizarListaPedidos', pedidosAtivos);
  });
});

const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
  console.log(`Servidor rodando com sucesso na porta ${PORTA}`);
});
