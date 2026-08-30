const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // Módulo essencial para gerenciar caminhos de pastas

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Aponta para a pasta 'public' onde estão o index.html, painel.html e logo.png
app.use(express.static(path.join(__dirname, 'public')));

// 2. Rotas para entregar as páginas corretamente no Render
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/painel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel.html'));
});

let lojaAberta = true;
let pedidosAtivos = []; // Array de memória para manter os pedidos salvos

// Estrutura do cardápio
let dadosCardapio = [
  {
    categoria: "Lanches",
    produtos: [
      { id: 1, nome: "X-Salada Especial", descricao: "Pão, hambúrguer 150g, queijo, alface, tomate e maionese.", preco: 22.00, ativo: true },
      { id: 2, nome: "X-Bacon", descricao: "Pão, hambúrguer 150g, muito bacon e queijo derretido.", preco: 25.00, ativo: true }
    ]
  },
  {
    categoria: "Salgados",
    produtos: [
      { id: 3, nome: "Coxinha de Frango c/ Catupiry", descricao: "Massa tradicional frita na hora.", preco: 8.00, ativo: true }
    ]
  },
  {
    categoria: "Bolos e Doces",
    produtos: [
      { id: 4, nome: "Fatia de Bolo de Chocolate", descricao: "Bolo molhadinho com cobertura de brigadeiro.", preco: 12.00, ativo: true }
    ]
  }
];

io.on('connection', (socket) => {
  // Envia o estado do cardápio e os pedidos ativos ao conectar ou atualizar (F5)
  socket.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  socket.emit('carregarPedidos', pedidosAtivos);

  // Alterar status da loja (Aberta / Fechada)
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
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // Adicionar Nova Categoria
  socket.on('adicionarCategoria', (nomeCategoria) => {
    const nomeLimpo = nomeCategoria.trim();
    if (nomeLimpo !== "") {
      const existe = dadosCardapio.some(c => c.categoria.toLowerCase() === nomeLimpo.toLowerCase());
      if (!existe) {
        dadosCardapio.push({ categoria: nomeLimpo, produtos: [] });
        io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
      }
    }
  });

  // Editar Nome de Categoria Existente
  socket.on('editarCategoria', ({ nomeAntigo, novoNome }) => {
    const nomeLimpo = novoNome.trim();
    if (nomeLimpo !== "") {
      const cat = dadosCardapio.find(c => c.categoria === nomeAntigo);
      if (cat) {
        cat.categoria = nomeLimpo;
        io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
      }
    }
  });

  // Excluir Categoria
  socket.on('excluirCategoria', (nomeCategoria) => {
    dadosCardapio = dadosCardapio.filter(c => c.categoria !== nomeCategoria);
    io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
  });

  // Adicionar Novo Produto
  socket.on('adicionarProduto', (novoProduto) => {
    const cat = dadosCardapio.find(c => c.categoria === novoProduto.categoria);
    if (cat) {
      cat.produtos.push({
        id: Date.now(),
        nome: novoProduto.nome,
        descricao: novoProduto.descricao,
        preco: parseFloat(novoProduto.preco),
        ativo: true
      });
      io.emit('atualizarEstado', { lojaAberta, cardapio: dadosCardapio });
    }
  });

  // RECEBER E GERENCIAR PEDIDOS
  socket.on('novoPedido', (pedido) => {
    pedido.status = 'pendente'; // Define o status padrão
    pedidosAtivos.unshift(pedido);
    
    // Notifica todas as conexões (incluindo o painel)
    io.emit('novoPedido', pedido);
    io.emit('receberPedido', pedido);
  });

  // Mudar Status (Aceitar Pedido / Colocar Em Preparo)
  socket.on('alterarStatusPedido', ({ id, status }) => {
    const pedido = pedidosAtivos.find(p => p.id === id);
    if (pedido) {
      pedido.status = status;
      io.emit('atualizarListaPedidos', pedidosAtivos);
    }
  });

  // Finalizar / Recusar Pedido (Remove da lista do painel)
  socket.on('removerPedido', (idPedido) => {
    pedidosAtivos = pedidosAtivos.filter(p => p.id !== idPedido);
    io.emit('atualizarListaPedidos', pedidosAtivos);
  });
});

// Porta dinâmica para o Render + fallback para porta 3000 local
const PORTA = process.env.PORT || 3000;
server.listen(PORTA, () => {
  console.log(`Servidor rodando com sucesso na porta ${PORTA}`);
});
