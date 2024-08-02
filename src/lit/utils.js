import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers } from "ethers";
import { AuthMethodScope, LitNetwork } from "@lit-protocol/constants";
import {
    LitActionResource,
    LitPKPResource,
    createSiweMessageWithRecaps,
    generateAuthSig,
} from "@lit-protocol/auth-helpers";
import { LitAbility } from "@lit-protocol/types";
import { ipfsHelpers } from "ipfs-helpers";
import { litActionA, litActionB } from "./actions";
import bs58 from "bs58";
import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";

const privateKey1 = process.env.REACT_APP_PRIVATE_KEY_1;
const privateKey2 = process.env.REACT_APP_PRIVATE_KEY_2;

const litNodeClient = new LitNodeClient({
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

let newlyMintedPKP = {
    "tokenId": "0x98518d192cefefd006b197b7a2485b065db159c0d8893c6640ff09ed7efaf2c9",
    "publicKey": "0493701734ca500fa70b2abdec1aaa3c1260f2fd52ce7c7d001fd3ca50882f1097dac38387d3b0dd06479f472893874511df5eb832efb1eeffdc68ebd234ce2f64",
    "ethAddress": "0x9B3444312F8bfDeF95Ece9F0939da337e68dc223"
}

// wallet getters --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

async function getWalletA() {
    // const provider = new ethers.providers.Web3Provider(window.ethereum);
    // const wallet = provider.getSigner();

    const provider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
    );
    const wallet = new ethers.Wallet(privateKey1, provider);
    return wallet;
}

async function getWalletB() {
    const provider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
    );
    const wallet = new ethers.Wallet(privateKey2, provider);
    return wallet;
}

// major functions --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// current user mints a new pkp
export async function mintPKPUsingEthWallet() {
    console.log("minting started..");
    const signerA = await getWalletA();

    const litContracts = new LitContracts({
        signer: signerA,
        network: LitNetwork.DatilDev,
        debug: false,
    });
    await litContracts.connect();

    const mintedPkp = await litContracts.pkpNftContractUtils.write.mint();
    console.log("Minted PKP to your wallet: ", mintedPkp.pkp);

    newlyMintedPKP = mintedPkp.pkp;
    return mintedPkp.pkp;
}

export async function addPermittedAction() {
    console.log("adding permitted action..");
    const signerA = await getWalletA();

    const ipfsCID_A = await uploadLitActionToIPFS(litActionA);
    const bytesCID_A = await stringToBytes(ipfsCID_A);

    const litContracts = new LitContracts({
        signer: signerA,
        network: LitNetwork.DatilDev,
        debug: false,
    });
    await litContracts.connect();

    await litContracts.addPermittedAction({
        pkpTokenId: newlyMintedPKP.tokenId,
        ipfsId: ipfsCID_A,
        authMethodScopes: [AuthMethodScope.SignAnything],
    });

    let isPermittedA =
        await litContracts.pkpPermissionsContract.read.isPermittedAction(
            newlyMintedPKP.tokenId,
            bytesCID_A
        );

    console.log("Auth method A added: ", isPermittedA);
}

// pkp is now owner of itself
export async function transferPKPToItself() {
    console.log("transfer started..");
    const signerA = await getWalletA();
    const address = signerA.address;

    const litContracts = new LitContracts({
        signer: signerA,
        network: LitNetwork.DatilDev,
        debug: false,
    });
    await litContracts.connect();

    const transferPkpOwnershipReceipt =
        await litContracts.pkpNftContract.write.transferFrom(
            address,
            newlyMintedPKP.ethAddress,
            newlyMintedPKP.tokenId,
            {
                gasLimit: 125_000,
            }
        );

    await transferPkpOwnershipReceipt.wait();

    console.log(
        "Transferred PKP ownership to itself: ",
        transferPkpOwnershipReceipt
    );
}

// funded pkp for sending transaction
export async function fundPKP() {
    console.log("funding started..");
    const signerA = await getWalletA();

    const fundPkpTxReceipt = await signerA.sendTransaction({
        to: newlyMintedPKP.ethAddress,
        value: ethers.utils.parseEther("0.00003"),
    });
    await fundPkpTxReceipt.wait();

    const balance = await signerA.provider.getBalance(
        newlyMintedPKP.ethAddress,
        "latest"
    );
    console.log(`Got balance: ${ethers.utils.formatEther(balance)} ether`);
}

// addPermittedAction is called with litActionB by PKPEthersWallet
export async function addAnotherAuthToPKP() {
    console.log("auth add started..");

    const authASessionSig = await sigA();

    const pkpAuthA = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: newlyMintedPKP.publicKey,
        controllerSessionSigs: authASessionSig,
    });

    await pkpAuthA.init();

    console.log(pkpAuthA);

    const litContractsPkpSignerA = new LitContracts({
        signer: pkpAuthA,
        network: LitNetwork.DatilDev,
        debug: false,
    });

    await litContractsPkpSignerA.connect();

    console.log("contracts client connected");

    const ipfsCID_B = await uploadLitActionToIPFS(litActionB);
    const bytesCID_B = await stringToBytes(ipfsCID_B);

    const addAuthMethodBReceipt =
        await litContractsPkpSignerA.pkpPermissionsContract.write.addPermittedAction(
            newlyMintedPKP.tokenId,
            bytesCID_B,
            [AuthMethodScope.SignAnything],
            {
                gasPrice: await pkpAuthA.provider.getGasPrice(),
                gasLimit: 550_000,
            }
        );
    await addAuthMethodBReceipt.wait();

    const isPermittedB =
        await litContractsPkpSignerA.pkpPermissionsContract.read.isPermittedAction(
            newlyMintedPKP.tokenId,
            bytesCID_B
        );

    console.log("Auth method B added: ", isPermittedB);
}

// removePermittedAction is called with litActionA by PKPEthersWallet
export async function RemoveInitialAuthMethod() {
    console.log("auth remove started..");

    const authBSessionSig = await sigB();

    const pkpAuthB = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: newlyMintedPKP.publicKey,
        controllerSessionSigs: authBSessionSig,
    });

    await pkpAuthB.init();

    console.log(pkpAuthB);

    const litContractsPkpSignerB = new LitContracts({
        signer: pkpAuthB,
        network: LitNetwork.DatilDev,
        debug: false,
    });

    await litContractsPkpSignerB.connect();

    console.log("contracts client connected");

    const ipfsCID_A = await uploadLitActionToIPFS(litActionA);
    const bytesCID_A = await stringToBytes(ipfsCID_A);

    const removeAuthMethodAReceipt =
        await litContractsPkpSignerB.pkpPermissionsContract.write.removePermittedAction(
            newlyMintedPKP.tokenId,
            bytesCID_A,
            {
                gasPrice: await pkpAuthB.provider.getGasPrice(),
                gasLimit: 100_000,
            }
        );
    await removeAuthMethodAReceipt.wait();

    let isPermittedA =
        await litContractsPkpSignerB.pkpPermissionsContract.read.isPermittedAction(
            newlyMintedPKP.tokenId,
            bytesCID_A
        );

    console.log("isPermittedA: ", isPermittedA);
}

export async function pkpSignTx() {
    console.log("pkp sign started..");

    // This can sign with authorized method
    const pkpAuthSessionSig = await sigA();

    const pkpEthersWallet = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: newlyMintedPKP.publicKey,
        controllerSessionSigs: pkpAuthSessionSig,
    });
    await pkpEthersWallet.init();

    const transactionObject = {
        to: "0x48e6a467852Fa29710AaaCDB275F85db4Fa420eB",
        value: ethers.BigNumber.from("10"),
        gasPrice: await pkpEthersWallet.provider.getGasPrice(),
        gasLimit: ethers.BigNumber.from("2100000"),
        data: "0x",
    };

    // const tx = await pkpEthersWallet.signTransaction(transactionObject)
    const tx = await pkpEthersWallet.sendTransaction(transactionObject);
    const receipt = await tx.wait();

    console.log("transaction: ", receipt);
}

export async function executeLitAction() {
    console.log("executing lit action..");

    const sessionSigs = await sigA();

    const chainProvider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
    );

    const ActionSignMessage = `(async () => {
        let toSign = new TextEncoder().encode('Hello World');
        toSign = ethers.utils.arrayify(ethers.utils.keccak256(toSign));

        const signature = await Lit.Actions.signEcdsa({
          toSign,
          publicKey,
          sigName: "signature",
        });

        Lit.Actions.setResponse({ response: JSON.stringify(signature) });
      })();
    `;

    const ActionSignTx = `
    (async () => {
        const serializedTx = ethers.utils.serializeTransaction(transactionObject);
        const toSign = ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.arrayify(serializedTx)));
        
        const signature = await Lit.Actions.signEcdsa({
            toSign: toSign,
            publicKey: publicKey,
            sigName: "chainSignature",
        });
        Lit.Actions.setResponse({ response: "signed" })
    })();
    `;

    const unsignedTransaction = {
        to: "0x48e6a467852Fa29710AaaCDB275F85db4Fa420eB",
        value: 1,
        gasLimit: 50_000,
        gasPrice: (await chainProvider.getGasPrice()).toHexString(),
        nonce: await chainProvider.getTransactionCount(
            newlyMintedPKP.ethAddress
        ),
        chainId: 175188,
    };
    console.log("txObject", unsignedTransaction);

    await litNodeClient.connect();

    const results = await litNodeClient.executeJs({
        code: ActionSignTx,
        sessionSigs: sessionSigs,
        jsParams: {
            publicKey: newlyMintedPKP.publicKey,
            transactionObject: unsignedTransaction,
        },
    });
    console.log("results from node: ", results);

    const sign = formatSignature(results.signatures.chainSignature);

    const signedTx = await chainProvider.sendTransaction(
        ethers.utils.serializeTransaction(unsignedTransaction, sign)
    );
    console.log("signedTx: ", signedTx)

}


export async function executeLitActionOnNode() {
    console.log("executing lit action (transfer on node) ..");

    const sessionSigs = await sigA();

    const ActionSendTxOnNode = `
       (async () => {
        const serializedTx = ethers.utils.serializeTransaction(transactionObject);
        const toSign = ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.arrayify(serializedTx)));

        const signature = await Lit.Actions.signAndCombineEcdsa({
            toSign: toSign,
            publicKey: publicKey,
            sigName: "chainSignature",
        });

        const jsonSignature = JSON.parse(signature);
        jsonSignature.r = "0x" + jsonSignature.r.substring(2);
        jsonSignature.s = "0x" + jsonSignature.s;
        const hexSignature = ethers.utils.joinSignature(jsonSignature);

        const signedTx = ethers.utils.serializeTransaction(
            transactionObject,
            hexSignature
        );

        let res = await Lit.Actions.runOnce(
            { waitForResponse: true, name: "txnSender" },
            async () => {
                const rpcUrl = await Lit.Actions.getRpcUrl({ chain: "baseSepolia" });
                const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
                // const provider = new ethers.providers.JsonRpcProvider("https://yellowstone-rpc.litprotocol.com");
                const tx = await provider.sendTransaction(signedTx);
                return tx.blockHash;
            }
        );
        Lit.Actions.setResponse({ res });
      })();
      `;

    const chainProvider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
    );

    const unsignedTransaction = {
        to: "0x48e6a467852Fa29710AaaCDB275F85db4Fa420eB",
        value: 1,
        gasLimit: 50_000,
        gasPrice: (await chainProvider.getGasPrice()).toHexString(),
        nonce: await chainProvider.getTransactionCount(
            newlyMintedPKP.ethAddress
        ),
        chainId: 175188,
    };
    console.log("txObject", unsignedTransaction);

    await litNodeClient.connect();

    const results = await litNodeClient.executeJs({
        code: ActionSendTxOnNode,
        sessionSigs: sessionSigs,
        jsParams: {
            publicKey: newlyMintedPKP.publicKey,
            transactionObject: unsignedTransaction,
        },
    });
    console.log("results: ", results);
}


// Auth Session Signatures --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// takes current user's wallet with litActionA for a session
export async function sigA() {
    const authWalletA = await getWalletA();

    await litNodeClient.connect();

    const pkpSessionSigsA = await litNodeClient.getLitActionSessionSigs({
        pkpPublicKey: newlyMintedPKP.publicKey,
        resourceAbilityRequests: [
            {
                resource: new LitPKPResource("*"),
                ability: LitAbility.PKPSigning,
            },
            {
                resource: new LitActionResource("*"),
                ability: LitAbility.LitActionExecution,
            },
        ],
        litActionCode: Buffer.from(litActionA).toString("base64"),
        jsParams: {
            authSig: JSON.stringify(
                await generateAuthSig({
                    signer: authWalletA,
                    toSign: await createSiweMessageWithRecaps({
                        uri: "http://localhost",
                        expiration: new Date(
                            Date.now() + 1000 * 60 * 60 * 24
                        ).toISOString(), // 24 hours
                        walletAddress: authWalletA.address,
                        nonce: await litNodeClient.getLatestBlockhash(),
                        litNodeClient,
                    }),
                })
            ),
        },
    });

    console.log("sessionSigs: ", pkpSessionSigsA);
    return pkpSessionSigsA;
}

// takes second wallet and litActionB for a session
export async function sigB() {
    const authWalletB = await getWalletB();

    await litNodeClient.connect();

    const pkpSessionSigsB = await litNodeClient.getLitActionSessionSigs({
        pkpPublicKey: newlyMintedPKP.publicKey,
        resourceAbilityRequests: [
            {
                resource: new LitPKPResource("*"),
                ability: LitAbility.PKPSigning,
            },
            {
                resource: new LitActionResource("*"),
                ability: LitAbility.LitActionExecution,
            },
        ],
        litActionCode: Buffer.from(litActionB).toString("base64"),
        jsParams: {
            authSig: JSON.stringify(
                await generateAuthSig({
                    signer: authWalletB,
                    toSign: await createSiweMessageWithRecaps({
                        uri: "http://localhost",
                        expiration: new Date(
                            Date.now() + 1000 * 60 * 60 * 24
                        ).toISOString(), // 24 hours
                        walletAddress: authWalletB.address,
                        nonce: await litNodeClient.getLatestBlockhash(),
                        litNodeClient,
                    }),
                })
            ),
        },
    });

    console.log("sessionSigs: ", pkpSessionSigsB);
    return pkpSessionSigsB;
}

// takes current user wallet for a session
// export async function sigC() {
//     console.log("clicked");
//     const provider = new ethers.providers.Web3Provider(window.ethereum);
//     const ethersSigner = provider.getSigner();

//     await litNodeClient.connect();

//     const sessionSigs = await litNodeClient.getSessionSigs({
//         chain: "ethereum",
//         resourceAbilityRequests: [
//             {
//                 resource: new LitPKPResource("*"),
//                 ability: LitAbility.PKPSigning,
//             },
//             {
//                 resource: new LitActionResource("*"),
//                 ability: LitAbility.LitActionExecution,
//             },
//         ],
//         authNeededCallback: async ({ resourceAbilityRequests }) => {
//             const toSign = await createSiweMessageWithRecaps({
//                 uri: "http://localhost:3000",
//                 expiration: new Date(
//                     Date.now() + 1000 * 60 * 60 * 24
//                 ).toISOString(), // 24 hours,
//                 resources: resourceAbilityRequests,
//                 walletAddress: await ethersSigner.getAddress(),
//                 nonce: await litNodeClient.getLatestBlockhash(),
//                 litNodeClient,
//             });

//             return await generateAuthSig({
//                 signer: ethersSigner,
//                 toSign,
//             });
//         },
//     });

//     console.log("sessionSigs: ", sessionSigs);
//     return sessionSigs;
// }

// helper functions --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

async function uploadLitActionToIPFS(litActionCode) {
    const ipfsHash = await ipfsHelpers.stringToCidV0(litActionCode);
    console.log("ipfsHash: ", ipfsHash);

    return ipfsHash;
}

async function stringToBytes(_string) {
    const LIT_ACTION_IPFS_CID_BYTES = `0x${Buffer.from(
        bs58.decode(_string)
    ).toString("hex")}`;

    return LIT_ACTION_IPFS_CID_BYTES;
}

export async function seeAuthMethods() {
    console.log("checking auth methods..");

    const litContracts = new LitContracts({
        network: LitNetwork.DatilDev,
    });
    await litContracts.connect();

    const authMethods =
        await litContracts.pkpPermissionsContract.read.getPermittedAuthMethods(
            newlyMintedPKP.tokenId
        );
    console.log(authMethods);
}

function formatSignature(signature) {
    const dataSigned = `0x${signature.dataSigned}`;

    const encodedSig = ethers.utils.joinSignature({
        v: signature.recid,
        r: `0x${signature.r}`,
        s: `0x${signature.s}`,
    });

    return encodedSig;
}
