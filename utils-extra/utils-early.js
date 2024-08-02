import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitAuthClient, EthWalletProvider } from "@lit-protocol/lit-auth-client";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers, Wallet } from "ethers";
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

const privateKey = process.env.REACT_APP_PRIVATE_KEY;

const litNodeClient = new LitNodeClient({
    alertWhenUnauthorized: false,
    litNetwork: LitNetwork.DatilDev,
    debug: true,
});

// let newlyMintedPKP = {
//     tokenId:
//         "0x30e2ea054fd6102b13e82d366ea681a5fff86b9cd144ee71e1c2780c2668f3f1",
//     publicKey:
//         "042d5612fc8bde40a4e87103cd140cebd5ba387ffd5627287cd9ebde10a67934a5a58bd0669437bb306865f7eb4d27792eb1a8b96ee43d94b3c2bc38d902b94df8",
//     ethAddress: "0x8107f25Ccfbada57593D2b72Ff7fa5a2842eB673",
// };

let newlyMintedPKP = {
    "tokenId": "0x8706c1a4ec470e5c9567bdfa7d4455c8286829d952ec75fdadc470efa40f9c3d",
    "publicKey": "04dbf9df60d7402ec250ebdb11277de812fda60a3d19c17dfa14633cb23c9a90a0a440328f1ce39f50008fc42d83369bc00b00529e6f0e59b599a5bb9b63b6fa7a",
    "ethAddress": "0x415541dc46eD914CA146Df3eb689A0565e612C27"
}

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

async function getAnotherWallet() {
    const provider = new ethers.providers.JsonRpcProvider(
        `https://yellowstone-rpc.litprotocol.com/`
    );

    const wallet = new Wallet(privateKey, provider);

    return wallet;
}

export async function seeAuthMethods() {
    console.log("started..");

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

// major functions --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// current user mints a new pkp
export async function mintPKPUsingEthWallet() {
    console.log("started..");
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const litContracts = new LitContracts({
        signer: ethersSigner,
        network: LitNetwork.DatilDev,
        debug: false,
    });

    await litContracts.connect();

    const mintedPkp = await litContracts.pkpNftContractUtils.write.mint();

    console.log("Minted PKP NFT: ", mintedPkp.pkp);

    newlyMintedPKP = mintedPkp.pkp;

    const ipfsCID_A = await uploadLitActionToIPFS(litActionA);

    const addAuthMethodAReceipt = await litContracts.addPermittedAction({
        pkpTokenId: mintedPkp.pkp.tokenId,
        ipfsId: ipfsCID_A,
        authMethodScopes: [AuthMethodScope.SignAnything],
    });

    console.log("addAuthMethodAReceipt: ", addAuthMethodAReceipt);

    const bytesCID_A = await stringToBytes(ipfsCID_A);

    let isPermittedA =
        await litContracts.pkpPermissionsContract.read.isPermittedAction(
            mintedPkp.tokenId,
            bytesCID_A
        );

    console.log("isPermittedA: ", isPermittedA);

    return mintedPkp.pkp;
}

// pkp is now owner of itself
export async function transferPKPToItself() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSignerA = provider.getSigner();
    const address = await provider.send("eth_requestAccounts", []);

    const litContracts = new LitContracts({
        signer: ethersSignerA,
        network: LitNetwork.DatilDev,
        debug: false,
    });

    await litContracts.connect();

    console.log(address[0], newlyMintedPKP.ethAddress, newlyMintedPKP.tokenId);

    const transferPkpOwnershipReceipt =
        await litContracts.pkpNftContract.write.transferFrom(
            address[0],
            newlyMintedPKP.ethAddress,
            newlyMintedPKP.tokenId,
            {
                gasLimit: 125_000,
            }
        );

    await transferPkpOwnershipReceipt.wait();

    console.log("tx: ", transferPkpOwnershipReceipt);
}

// funded pkp for sending transaction
export async function fundPKP() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const fundPkpTxReceipt = await ethersSigner.sendTransaction({
        to: newlyMintedPKP.ethAddress,
        value: ethers.utils.parseEther("0.00003"),
    });

    await fundPkpTxReceipt.wait();

    const balance = await ethersSigner.provider.getBalance(
        newlyMintedPKP.ethAddress,
        "latest"
    );
    console.log(`✅ Got balance: ${ethers.utils.formatEther(balance)} ether`);
}

// gasPrice:  "1",
//     gasPrice: await ethersSignerA.provider.getGasPrice(),

// {
//     gasLimit: 250_000,
// }

// takes current user sign with litActionA for a session to create PKPEthersWallet
// addPermittedAction is called with litActionB by PKPEthersWallet
export async function addAnotherAuthToPKP() {
    console.log("started..");

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSignerA = provider.getSigner();

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
        // litActionIpfsId: ipfsCID_A,
        litActionCode: Buffer.from(litActionA).toString("base64"),
        jsParams: {
            authSig: JSON.stringify(
                await generateAuthSig({
                    signer: ethersSignerA,
                    toSign: await createSiweMessageWithRecaps({
                        uri: "http://localhost:3000",
                        expiration: new Date(
                            Date.now() + 1000 * 60 * 60 * 24
                        ).toISOString(), // 24 hours
                        walletAddress: await ethersSignerA.getAddress(),
                        nonce: await litNodeClient.getLatestBlockhash(),
                        litNodeClient,
                    }),
                })
            ),
        },
    });
    console.log(pkpSessionSigsA);

    const pkpEthersWalletA = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: newlyMintedPKP.publicKey,
        controllerSessionSigs: pkpSessionSigsA,
    });

    await pkpEthersWalletA.init();

    console.log(pkpEthersWalletA);

    const litContractsPkpSignerA = new LitContracts({
        signer: pkpEthersWalletA,
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
                gasPrice: await ethersSignerA.provider.getGasPrice(),
                gasLimit: 550_000,
            }
        );

    await addAuthMethodBReceipt.wait();

    const isPermittedB =
        await litContractsPkpSignerA.pkpPermissionsContract.read.isPermittedAction(
            newlyMintedPKP.tokenId,
            bytesCID_B
        );

    console.log("isPermittedB: ", isPermittedB);
}

// takes second wallet and litActionB for a session sign to create PKPEthersWallet
// removePermittedAction is called with litActionA by PKPEthersWallet
export async function RemoveInitialAuthMethod() {
    console.log("started..");

    const anotherAuthWallet = await getAnotherWallet();

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
                    signer: anotherAuthWallet,
                    // @ts-ignore
                    toSign: await createSiweMessageWithRecaps({
                        uri: "http://localhost",
                        expiration: new Date(
                            Date.now() + 1000 * 60 * 60 * 24
                        ).toISOString(), // 24 hours
                        walletAddress: anotherAuthWallet.address,
                        nonce: await litNodeClient.getLatestBlockhash(),
                        litNodeClient,
                    }),
                })
            ),
        },
    });
    console.log("✅ Got PKP Session Sigs using Lit Action Auth Method B");

    const pkpEthersWalletB = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: newlyMintedPKP.publicKey,
        controllerSessionSigs: pkpSessionSigsB,
    });

    await pkpEthersWalletB.init();

    console.log(pkpEthersWalletB);

    const litContractsPkpSignerB = new LitContracts({
        signer: pkpEthersWalletB,
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
                gasPrice: await pkpEthersWalletB.provider.getGasPrice(),
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

export async function executeLitAction() {
    console.log("started..");

    const sessionSigs = await sig3();

    const lASignTx = 
    `(async () => {
        let toSign = new TextEncoder().encode('Hello World');
        toSign = ethers.utils.arrayify(ethers.utils.keccak256(toSign));

        const signature = await Lit.Actions.signAndCombineEcdsa({
          toSign,
          publicKey,
          sigName,
        });

        console.log('hello 1')

        Lit.Actions.setResponse({ response: JSON.stringify(signature) });
      })();
    `;

    // let txn = {
    //     to: "0x48e6a467852Fa29710AaaCDB275F85db4Fa420eB",
    //     value: ethers.BigNumber.from("10"),
    //     gasLimit: ethers.BigNumber.from("2100000"),
    //     data: "0x",
    //     // nonce: ethers.BigNumber.from("6")
    //     };

    // toSign = ethers.utils.arrayify(ethers.utils.keccak256(toSign));
    // toSign = ethers.utils.arrayify(ethers.utils.keccak256(toSign));

    const lASendTx = 
    `(async () => {
        let transactionObject = {
            to: "0x48e6a467852Fa29710AaaCDB275F85db4Fa420eB",
            value: ethers.BigNumber.from("10"),
            gasLimit: ethers.BigNumber.from("2100000"),
            data: "0x",
            // nonce: ethers.BigNumber.from("5")
        };
      
        const serializedTx = ethers.utils.serializeTransaction(transactionObject);
        let hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(serializedTx));
        let toSign = await new TextEncoder().encode(hash);
        toSign = ethers.utils.arrayify(ethers.utils.keccak256(toSign));

        const signature = await Lit.Actions.signAndCombineEcdsa({
            toSign,
            publicKey,
            sigName,
        });
        console.log("executed");
      
        Lit.Actions.setResponse({ response: signature });
      })();
    `;

    await litNodeClient.connect();

    const results = await litNodeClient.executeJs({
        code: lASendTx,
        sessionSigs: sessionSigs,
        jsParams: {
            publicKey: newlyMintedPKP.publicKey,
            sigName: "sig",
        },
    });

    console.log("logs: ", results.logs);

    console.log("results: ", results);
}

export async function pkpSignTx() {
    console.log("started..");

    const pkpSessionSigsA = await sig3();

    const pkpEthersWallet = new PKPEthersWallet({
        litNodeClient,
        pkpPubKey: newlyMintedPKP.publicKey,
        controllerSessionSigs: pkpSessionSigsA,
    });

    await pkpEthersWallet.init();

    console.log(pkpEthersWallet);

    const transactionObject = {
        to: "0x48e6a467852Fa29710AaaCDB275F85db4Fa420eB",
        value: ethers.BigNumber.from("10"),
        gasPrice: await pkpEthersWallet.provider.getGasPrice(),
        gasLimit: ethers.BigNumber.from("2100000"),
        data: "0x",
        // nonce: ethers.BigNumber.from("1"),
    };

    const tx = await pkpEthersWallet.sendTransaction(transactionObject);

    const receipt = await tx.wait();

    console.log(receipt);
}

// Auth Methods --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export async function calculateTime() {
    console.log("started..");
    let startTime = new Date().getTime();

    await litNodeClient.connect();

    let endTime = new Date().getTime();

    let executionTime = endTime - startTime;
    console.log(`Execution time: ${executionTime} ms`);
}

// --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export async function sig1() {
    console.log("clicked");
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    await litNodeClient.connect();

    const sessionSigs = await litNodeClient.getSessionSigs({
        chain: "ethereum",
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
        authNeededCallback: async ({ resourceAbilityRequests }) => {
            const toSign = await createSiweMessageWithRecaps({
                uri: "http://localhost:3000",
                expiration: new Date(
                    Date.now() + 1000 * 60 * 60 * 24
                ).toISOString(), // 24 hours,
                resources: resourceAbilityRequests,
                walletAddress: await ethersSigner.getAddress(),
                nonce: await litNodeClient.getLatestBlockhash(),
                litNodeClient,
            });

            return await generateAuthSig({
                signer: ethersSigner,
                toSign,
            });
        },
    });

    console.log("sessionSigs: ", sessionSigs);
    return sessionSigs;
}

export async function sig2() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSignerA = provider.getSigner();

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
                    signer: ethersSignerA,
                    // @ts-ignore
                    toSign: await createSiweMessageWithRecaps({
                        uri: "http://localhost",
                        expiration: new Date(
                            Date.now() + 1000 * 60 * 60 * 24
                        ).toISOString(), // 24 hours
                        walletAddress: await ethersSignerA.getAddress(),
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

// Generating a Session Signature from the Capacity Credit delegation
// for executeJs

export async function sig3() {
    const anotherAuthWallet = await getAnotherWallet();

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
                    signer: anotherAuthWallet,
                    // @ts-ignore
                    toSign: await createSiweMessageWithRecaps({
                        uri: "http://localhost",
                        expiration: new Date(
                            Date.now() + 1000 * 60 * 60 * 24
                        ).toISOString(), // 24 hours
                        walletAddress: anotherAuthWallet.address,
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

export async function sig4() {

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner()

    const authMethod = await EthWalletProvider.authenticate({
        signer: ethersSigner,
        litNodeClient,
      });

    const sessionSignatures = await litNodeClient.getPkpSessionSigs({
        pkpPublicKey: newlyMintedPKP.publicKey,
        authMethods: [authMethod],
        resourceAbilityRequests: [
          {
            resource: new LitActionResource("*"),
            ability: LitAbility.LitActionExecution,
          },
        ],
        expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
      });
}

export async function sig5() {
    const walletWithCapacityCredit = new Wallet(
        "<your private key or mnemonic>"
    );

    let contractClient = new LitContracts({
        // signer: dAppOwnerWallet,
        network: "habanero",
    });

    // this identifier will be used in delegation requests.
    const { capacityTokenIdStr } = await contractClient.mintCapacityCreditsNFT({
        requestsPerKilosecond: 80,
        // requestsPerDay: 14400,
        // requestsPerSecond: 10,
        daysUntilUTCMidnightExpiration: 2,
    });

    const { capacityDelegationAuthSig } =
        await litNodeClient.createCapacityDelegationAuthSig({
            uses: "1",
            signer: walletWithCapacityCredit,
            capacityTokenId: capacityTokenIdStr,
            delegateeAddresses: [newlyMintedPKP.ethAddress],
        });

    const pkpAuthNeededCallback = async ({
        expiration,
        resources,
        resourceAbilityRequests,
    }) => {
        // -- validate
        if (!expiration) {
            throw new Error("expiration is required");
        }

        if (!resources) {
            throw new Error("resources is required");
        }

        if (!resourceAbilityRequests) {
            throw new Error("resourceAbilityRequests is required");
        }

        const response = await litNodeClient.signSessionKey({
            statement: "Some custom statement.",
            authMethods: [walletWithCapacityCredit], // authMethods for signing the sessionSigs
            pkpPublicKey: newlyMintedPKP.publicKey, // public key of the wallet which is delegated
            expiration: expiration,
            resources: resources,
            chainId: 1,

            // optional (this would use normal siwe lib, without it, it would use lit-siwe)
            resourceAbilityRequests: resourceAbilityRequests,
        });

        console.log("response:", response);

        return response.authSig;
    };

    const pkpSessionSigs = await litNodeClient.getSessionSigs({
        pkpPublicKey: newlyMintedPKP.publicKey, // public key of the wallet which is delegated
        expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
        chain: "ethereum",
        resourceAbilityRequests: [
            {
                resource: new LitPKPResource("*"),
                ability: LitAbility.PKPSigning,
            },
        ],
        authNeededCallback: pkpAuthNeededCallback,
        capacityDelegationAuthSig, // here is where we add the delegation to our session request
    });

    console.log("sessionSigs: ", pkpSessionSigs);
    return pkpSessionSigs;
}

export async function sig6() {

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const authMethod = await EthWalletProvider.authenticate({
        signer: ethersSigner,
        litNodeClient,
      });

    const litActionCode = `const go = async () => {
        Lit.Actions.setResponse({ response: "true" });
     };
       go();
   `;

    const sessionSignatures = await litNodeClient.getLitActionSessionSigs({
        pkpPublicKey: newlyMintedPKP.publicKey,
        authMethods: [authMethod],
        chain: "ethereum",
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
        litActionCode: Buffer.from(litActionCode).toString("base64"),
        jsParams: {},
      });
}

// // -- preparing the parameters
// const authMethod = await EthWalletProvider.authenticate({
//     signer: YOUR_WALLET_SIGNER,
//     litNodeClient,
//   });

//   const authMethodOwnedPkpPublicKey = '0x..';

//   const resourceAbilityRequests = [
//     {
//       resource: new LitPKPResource('*'),
//       ability: LitAbility.PKPSigning,
//     },
//     {
//       resource: new LitActionResource('*'),
//       ability: LitAbility.LitActionExecution,
//     },
//   ];

//   // -- get pkp session sigs
//   const pkpSessionSigs = await litNodeClient.getPkpSessionSigs({
//     pkpPublicKey: authMethodOwnedPkpPublicKey,
//     authMethods: [authMethod],
//     resourceAbilityRequests: resourceAbilityRequests,
//   });

// const litActionSessionSigs = await litNodeClient.getPkpSessionSigs({
//     pkpPublicKey: authMethodOwnedPkpPublicKey,
//     authMethods: [authMethod],
//     resourceAbilityRequests: resourceAbilityRequests,
//     litActionCode: customAuthLitActionCode,
//     jsParams: {
//       publicKey: authMethodOwnedPkpPublicKey,
//       sigName: 'custom-auth',
//     },
//   });

// async function getSignerAuthA() {
//     const provider = new ethers.providers.Web3Provider(window.ethereum);
//     const signer = provider.getSigner();
//     const address = await signer.getAddress();
//     return { signer, address };
// }

// export async function getSignerAuthB() {
//     const anotherAuthWallet = await getAnotherWallet();

//     await litNodeClient.connect();

//     const pkpSessionSigsB = await litNodeClient.getLitActionSessionSigs({
//         pkpPublicKey: newlyMintedPKP.publicKey,
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
//         litActionCode: Buffer.from(litActionB).toString("base64"),
//         jsParams: {
//             authSig: JSON.stringify(
//                 await generateAuthSig({
//                     signer: anotherAuthWallet,
//                     // @ts-ignore
//                     toSign: await createSiweMessageWithRecaps({
//                         uri: "http://localhost",
//                         expiration: new Date(
//                             Date.now() + 1000 * 60 * 60 * 24
//                         ).toISOString(), // 24 hours
//                         walletAddress: anotherAuthWallet.address,
//                         nonce: await litNodeClient.getLatestBlockhash(),
//                         litNodeClient,
//                     }),
//                 })
//             ),
//         },
//     });
//     console.log("✅ Got PKP Session Sigs using Lit Action Auth Method B");

//     const pkpEthersWalletB = new PKPEthersWallet({
//         litNodeClient,
//         pkpPubKey: newlyMintedPKP.publicKey,
//         controllerSessionSigs: pkpSessionSigsB,
//     });

//     await pkpEthersWalletB.init();

//     const address = await pkpEthersWalletB.getAddress();

//     console.log(pkpEthersWalletB);
//     console.log("pkpAddress", address);

//     return { pkpEthersWalletB, address };
// }


    // This method is used to create a cryptographic signature of a transaction using the sender’s private key.
    // const tx = await pkpEthersWallet.signTransaction(transactionObject);

    // This method is used to both sign and broadcast a transaction to the Ethereum network.
    // const tx = await pkpEthersWallet.sendTransaction(transactionObject);