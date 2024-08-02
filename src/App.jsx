import "./App.css";
import { useState } from "react";
import {
    mintPKPUsingEthWallet,
    addPermittedAction,
    transferPKPToItself,
    fundPKP,
    addAnotherAuthToPKP,
    RemoveInitialAuthMethod,
    seeAuthMethods,
    pkpSignTx,
    executeLitAction,
    executeLitActionOnNode
} from "./lit/utils";

function App() {
    const [ethAddress, setEthAddress] = useState("");

    async function mintPKPCall() {
        const pkp = await mintPKPUsingEthWallet();
        setEthAddress(pkp?.ethAddress);
    }

    return (
        <div className="App">
            <h2>LIT DEMO</h2>

            <p>pkp eth address, {ethAddress}</p>

            <button onClick={mintPKPCall}>Mint PKP With First Auth</button>

            <button onClick={addPermittedAction}>Add Auth A</button>

            <button onClick={transferPKPToItself}>
                Transfer PKP To Itself
            </button>

            <button onClick={fundPKP}>Fund PKP</button>

            <button onClick={addAnotherAuthToPKP}>Add Auth B</button>

            <button onClick={RemoveInitialAuthMethod}>
                Remove Auth A
            </button>

            <button onClick={seeAuthMethods}>See Permitted Method</button>

            <button onClick={pkpSignTx}>PKP Sign</button>

            <button onClick={executeLitAction}>Execute LitAction</button>

            <button onClick={executeLitActionOnNode}>LitAction (Run On Node)</button>
        </div>
    );
}

export default App;
