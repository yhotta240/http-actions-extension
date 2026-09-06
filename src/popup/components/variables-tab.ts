import type { Secrets, Variables } from "../../types/actions";
import { getSecrets, getVariables, setSecrets, setVariables } from "../../utils/storage";

export function setupVariablesTab(container: HTMLElement): void {
  container.innerHTML = `
    <div class="mb-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="m-0 fw-bold">ユーザー定義変数 (Variables)</h6>
        <small class="text-muted"><code>{{var.キー名}}</code> で参照</small>
      </div>
      <div id="vars-list" class="mb-2"></div>
      <div class="input-group input-group-sm">
        <input type="text" class="form-control" id="new-var-key" placeholder="キー名 (例: apiBase)">
        <input type="text" class="form-control" id="new-var-val" placeholder="値 (例: http://localhost:3000)">
        <button class="btn btn-primary" type="button" id="btn-add-var">
          <i class="bi bi-plus-lg"></i> 追加
        </button>
      </div>
    </div>

    <hr>

    <div class="mb-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="m-0 fw-bold text-danger-emphasis">シークレット (Secrets)</h6>
        <small class="text-muted"><code>{{secret.キー名}}</code> で参照</small>
      </div>
      <div id="secrets-list" class="mb-2"></div>
      <div class="input-group input-group-sm">
        <input type="text" class="form-control" id="new-secret-key" placeholder="キー名 (例: token)">
        <input type="password" class="form-control" id="new-secret-val" placeholder="シークレット値 (例: eyJ...)">
        <button class="btn btn-danger" type="button" id="btn-add-secret">
          <i class="bi bi-plus-lg"></i> 追加
        </button>
      </div>
    </div>
  `;

  const varsList = container.querySelector("#vars-list") as HTMLElement;
  const newVarKey = container.querySelector("#new-var-key") as HTMLInputElement;
  const newVarVal = container.querySelector("#new-var-val") as HTMLInputElement;
  const btnAddVar = container.querySelector("#btn-add-var") as HTMLButtonElement;

  const secretsList = container.querySelector("#secrets-list") as HTMLElement;
  const newSecretKey = container.querySelector("#new-secret-key") as HTMLInputElement;
  const newSecretVal = container.querySelector("#new-secret-val") as HTMLInputElement;
  const btnAddSecret = container.querySelector("#btn-add-secret") as HTMLButtonElement;

  const renderVars = async () => {
    const vars: Variables = await getVariables();
    varsList.innerHTML = "";

    const keys = Object.keys(vars);
    if (keys.length === 0) {
      varsList.innerHTML =
        '<div class="small text-muted p-2 border rounded">変数が登録されていません</div>';
      return;
    }

    const table = document.createElement("table");
    table.className = "table table-sm table-bordered align-middle mb-0";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 35%;">Key</th>
          <th>Value</th>
          <th style="width: 40px;"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody") as HTMLElement;

    keys.forEach((key) => {
      const tr = document.createElement("tr");

      const tdKey = document.createElement("td");
      tdKey.className = "font-monospace small";
      tdKey.textContent = key;

      const tdVal = document.createElement("td");
      tdVal.className = "small text-truncate";
      tdVal.style.maxWidth = "160px";
      tdVal.textContent = vars[key];
      tdVal.title = vars[key];

      const tdAction = document.createElement("td");
      tdAction.className = "text-center";
      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-link text-danger p-0";
      delBtn.innerHTML = '<i class="bi bi-trash"></i>';
      delBtn.title = "削除";
      delBtn.addEventListener("click", async () => {
        delete vars[key];
        await setVariables(vars);
        renderVars();
      });
      tdAction.appendChild(delBtn);

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });

    varsList.appendChild(table);
  };

  const renderSecrets = async () => {
    const secrets: Secrets = await getSecrets();
    secretsList.innerHTML = "";

    const keys = Object.keys(secrets);
    if (keys.length === 0) {
      secretsList.innerHTML =
        '<div class="small text-muted p-2 border rounded">シークレットが登録されていません</div>';
      return;
    }

    const table = document.createElement("table");
    table.className = "table table-sm table-bordered align-middle mb-0";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 35%;">Key</th>
          <th>Value (Masked)</th>
          <th style="width: 70px;"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody") as HTMLElement;

    keys.forEach((key) => {
      const tr = document.createElement("tr");

      const tdKey = document.createElement("td");
      tdKey.className = "font-monospace small";
      tdKey.textContent = key;

      const tdVal = document.createElement("td");
      tdVal.className = "small font-monospace";
      let isMasked = true;
      tdVal.textContent = "••••••••••••";

      const tdAction = document.createElement("td");
      tdAction.className = "text-center d-flex justify-content-center gap-1";

      const eyeBtn = document.createElement("button");
      eyeBtn.className = "btn btn-sm btn-link text-secondary p-0";
      eyeBtn.innerHTML = '<i class="bi bi-eye"></i>';
      eyeBtn.title = "表示/非表示切替";
      eyeBtn.addEventListener("click", () => {
        isMasked = !isMasked;
        tdVal.textContent = isMasked ? "••••••••••••" : secrets[key];
        eyeBtn.innerHTML = isMasked
          ? '<i class="bi bi-eye"></i>'
          : '<i class="bi bi-eye-slash"></i>';
      });

      const delBtn = document.createElement("button");
      delBtn.className = "btn btn-sm btn-link text-danger p-0";
      delBtn.innerHTML = '<i class="bi bi-trash"></i>';
      delBtn.title = "削除";
      delBtn.addEventListener("click", async () => {
        delete secrets[key];
        await setSecrets(secrets);
        renderSecrets();
      });

      tdAction.appendChild(eyeBtn);
      tdAction.appendChild(delBtn);

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdAction);
      tbody.appendChild(tr);
    });

    secretsList.appendChild(table);
  };

  btnAddVar.addEventListener("click", async () => {
    const key = newVarKey.value.trim();
    const val = newVarVal.value.trim();
    if (!key) return;

    const vars = await getVariables();
    vars[key] = val;
    await setVariables(vars);
    newVarKey.value = "";
    newVarVal.value = "";
    renderVars();
  });

  btnAddSecret.addEventListener("click", async () => {
    const key = newSecretKey.value.trim();
    const val = newSecretVal.value;
    if (!key) return;

    const secrets = await getSecrets();
    secrets[key] = val;
    await setSecrets(secrets);
    newSecretKey.value = "";
    newSecretVal.value = "";
    renderSecrets();
  });

  renderVars();
  renderSecrets();
}
