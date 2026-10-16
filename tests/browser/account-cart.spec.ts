import { test, expect } from '@playwright/test';

test('account cart restores after switching users and serializes writes', async ({ page }) => {
  const saved: Record<string, any[]> = { A: [{ variant_id: 'one', quantity: 2 }], B: [] };
  let owner = 'A';
  await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, json: {} }));
  await page.route('**/api/cart', async route => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const body = request.postDataJSON();
      await new Promise(resolve => setTimeout(resolve, 80));
      saved[body.user_id] = body.items;
      await route.fulfill({ json: { user_id: body.user_id, items: body.items } });
    } else await route.fulfill({ json: { user_id: owner, items: saved[owner] } });
  });
  await page.route('**/cart-harness', route => route.fulfill({ contentType: 'text/html', body: `
    <div id="root"></div><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {useAccountCart} from '/src/useAccountCart.ts';
    function App(){
      const [owner,setOwner]=React.useState('A');
      const c=useAccountCart(owner,true,()=>{});
      return React.createElement('div',null,
        React.createElement('output',null,JSON.stringify({owner,ready:c.cartReady,items:c.cart})),
        ...['A','B'].map(id=>React.createElement('button',{onClick:()=>setOwner(id)},id)),
        React.createElement('button',{disabled:!c.cartReady,onClick:()=>c.setCart([{variant_id:'one',quantity:(c.cart[0]?.quantity||0)+1}])},'Add'));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
    </script>` }));
  await page.goto('/cart-harness');
  await expect(page.locator('output')).toContainText('"quantity":2');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => saved.A[0].quantity).toBe(4);
  owner = 'B';
  await page.getByRole('button', { name: 'B', exact: true }).click();
  await expect(page.locator('output')).toHaveText('{"owner":"B","ready":true,"items":[]}');
  owner = 'A';
  await page.getByRole('button', { name: 'A', exact: true }).click();
  await expect(page.locator('output')).toContainText('"quantity":4');
  await page.reload();
  await expect(page.locator('output')).toContainText('"quantity":4');
});

