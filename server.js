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

// Configurações padrão de entrega com o seu endereço em Dourados/MS
const DEFAULT_CONFIG = {
  lojaEndereco: "Rua Demeciano de Mattos Pereira, 3250 - Jardim Novo Horizonte, Dourados - MS",
  lojaLat: -22.20389,
  lojaLng: -54.83296,
  taxaBase: 5.00,       // Valor mínimo de entrega
  valorPorKm: 1.50,      // Valor cobrado por km percorrido
  distanciaMaximaKm: 20 // Limite de entrega em km
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

// Função para calcular distância entre duas coordenadas (Fórmula de Haversine com ajuste para malha viária)
function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distanciaLinhaReta = R * c;
  
  // Fator 1.30 estimando curvas, trajetos e ruas
  return distanciaLinhaReta * 1.30;
}

// Função para calcular a taxa de entrega baseada na localização
function calcularTaxaEntrega(clienteLat, clienteLng) {
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

  // Cálculo da taxa: Taxa base + (Distância * Valor por Km)
  const taxaCalculada = configLoja.taxaBase + (distanciaKm * configLoja.valorPorKm);
  
  return {
    entregavel: true,
    distanciaKm: parseFloat(distanciaKm.toFixed(2)),
    taxaEntrega: parseFloat(taxaCalculada.toFixed(2))
  };
}

// Função para carregar o cardápio do arquivo JSON
function carregarCardapio() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error("Erro ao ler cardapio.json, usando padrão:", err);
    }
  }
  return [
    {
      categoria: "Lanches",
      produtos: [
        { id: 1, nome: "Hambúrguer 150g", descricao: "Carne artesanal grelhada na hora.", preco: 12.00, ativo: true },
        { id: 2, nome: "Bacon Crocante", descricao: "Porção de bacon em fatias.", preco: 5.00, ativo: true }
      ]
    },
    {
      categoria: "Bebidas",
      produtos: [
        { id: 3, nome: "Refrigerante Lata", descricao: "Lata 350ml trincando de gelada.", preco: 6.00, ativo: true }
      ]
    }
  ];
}

// Função para carregar pedidos salvos do arquivo JSON
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

// Funções para salvar os arquivos JSON
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

// Inicialização das variáveis em memória
let dadosCardapio = carregarCardapio();
let pedidosAtivos = carregarPedidos();
let lojaAberta = true;

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/painel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});

// Endpoint ou Socket para calcular taxa de entrega
app.post('/api/calcular-taxa', (req, res) => {
  const { lat, lng } = req.body;
  const resultado = calcularTaxaEntrega(lat, lng);
  res.json(resultado);
});

io.on('connection', (socket) => {
  // Envia o estado atualizado do cardápio e pedidos ao conectar
  socket.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio, configEntrega: configLoja });
  socket.emit('carregarPedidos', pedidosAtivos);

  // Evento para calcular taxa via WebSocket
  socket.on('calcularTaxaEntrega', ({ lat, lng }, callback) => {
    const resultado = calcularTaxaEntrega(lat, lng);
    if (typeof callback === 'function') {
      callback(resultado);
    } else {
      socket.emit('resultadoTaxaEntrega', resultado);
    }
  });

  // Atualizar configurações de entrega
  socket.on('atualizarConfigEntrega', (novasConfigs) => {
    configLoja = { ...configLoja, ...novasConfigs };
    salvarConfig();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio, configEntrega: configLoja });
  });

  // Status da Loja (Aberto/Fechado)
  socket.on('mudarStatusLoja', (status) => {
    lojaAberta = status;
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // Ativar ou Desativar Produto
  socket.on('mudarStatusProduto', ({ idProduto, disponivel }) => {
    dadosCardapio.forEach(cat => {
      const prod = cat.produtos.find(p => p.id === idProduto);
      if (prod) prod.ativo = disponivel;
    });
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // EDITAR PRODUTO (NOME, PREÇO, DESCRIÇÃO)
  socket.on('editarProduto', ({ idProduto, nome, preco, descricao }) => {
    dadosCardapio.forEach(cat => {
      const prod = cat.produtos.find(p => p.id === idProduto);
      if (prod) {
        if (nome) prod.nome = nome.trim();
        if (preco !== undefined && !isNaN(preco)) prod.preco = parseFloat(preco);
        if (descricao !== undefined) prod.descricao = descricao.trim();
      }
    });
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // EXCLUIR PRODUTO
  socket.on('excluirProduto', (idProduto) => {
    dadosCardapio.forEach(cat => {
      cat.produtos = cat.produtos.filter(p => p.id !== idProduto);
    });
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // Adicionar Nova Categoria
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

  // Editar Nome de Categoria
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

  // Excluir Categoria
  socket.on('excluirCategoria', (nomeCategoria) => {
    dadosCardapio = dadosCardapio.filter(c => c.categoria !== nomeCategoria);
    salvarCardapio();
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // Adicionar Novo Produto
  socket.on('adicionarProduto', (novoProduto) => {
    const catEnviada = (novoProduto.categoria || '').trim().toLowerCase();
    
    const cat = dadosCardapio.find(c => {
      const catNome = c.categoria.toLowerCase();
      return catNome === catEnviada || (catEnviada.includes('lanche') && catNome.includes('lanche'));
    });

    if (cat) {
      cat.produtos.push({
        id: Date.now(),
        nome: novoProduto.nome,
        descricao: novoProduto.descricao || '',
        preco: parseFloat(novoProduto.preco),
        ativo: true
      });
      salvarCardapio();
      io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
    }
  });

  // GESTÃO DE PEDIDOS (COM PERSISTÊNCIA E NOTIFICAÇÃO DE SAÍDA)
  socket.on('novoPedido', (pedido) => {
    if (!pedido.id) pedido.id = Date.now();
    pedido.status = 'pendente';
    
    // Insere no início para o mais recente ficar no topo
    pedidosAtivos.unshift(pedido);
    salvarPedidos();

    // Emite para o painel em tempo real
    io.emit('novoPedido', pedido);
    io.emit('atualizarListaPedidos', pedidosAtivos);
  });

  socket.on('alterarStatusPedido', ({ id, status }) => {
    const pedido = pedidosAtivos.find(p => p.id === id);
    if (pedido) {
      pedido.status = status;
      salvarPedidos();

      // Notifica o cliente via socket caso a página dele esteja escutando
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
