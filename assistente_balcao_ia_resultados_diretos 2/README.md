# Assistente de Balcão IA

Site responsivo para pesquisar códigos EAN/GTIN de medicamentos na internet usando IA com pesquisa web. Ao enviar o nome, a resposta aparece dentro do próprio site em uma tabela com fontes — não é uma lista de links para o usuário pesquisar manualmente.

## O que já está implementado
- Campo de busca por nome comercial, princípio ativo ou grafia aproximada.
- Backend seguro: a chave da API fica no servidor, nunca no navegador.
- Pesquisa web através da Responses API da OpenAI.
- Resposta focada em EAN, fabricante e apresentação.
- Fontes consultadas quando disponíveis.
- Não deve inventar EANs nem afirmar estoque em distribuidor sem confirmação.
- Interface responsiva e botão para copiar o resultado.

## Requisito para ativar a IA
É necessária uma chave de API da OpenAI com faturamento/configuração válidos. A assinatura do ChatGPT não inclui automaticamente créditos de API.

1. Instale Node.js 20 ou superior.
2. Extraia a pasta do projeto.
3. No terminal, dentro da pasta, execute `npm install`.
4. Copie `.env.example` para `.env`.
5. Preencha `OPENAI_API_KEY` com sua chave obtida em https://platform.openai.com/api-keys.
6. Execute `npm start`.
7. Abra `http://localhost:3000`.

## Publicar na internet
Pode publicar em um serviço Node.js como Render, Railway ou outro host compatível:
- envie a pasta para um repositório privado no GitHub;
- crie um serviço Web Service usando esse repositório;
- comando de build: `npm install`;
- comando de início: `npm start`;
- configure `OPENAI_API_KEY` e, opcionalmente, `OPENAI_MODEL` nas variáveis de ambiente do serviço;
- publique e abra a URL que o host fornecer.

Não coloque a chave de API no HTML, no JavaScript do navegador, nem em repositório público.

## Limitações importantes
- Esta versão pesquisa na web; ela não está conectada às contas privadas nem ao estoque interno de Santa Cruz, PanFarma ou ProFarma. Para consultar preço/estoque real desses distribuidores, é necessário acesso autorizado e integração/API de cada um.
- A pesquisa na web pode não localizar todos os EANs. Confirme no catálogo/ficha do fabricante ou no sistema do distribuidor antes de comprar ou dispensar.
- Não é um sistema de prescrição nem substitui conferência profissional.
