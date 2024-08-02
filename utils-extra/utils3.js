import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LitAuthClient, isSignInRedirect } from "@lit-protocol/lit-auth-client";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers, Wallet, BigNumber } from "ethers";
import { stringify } from "flatted";
import {
    ProviderType,
    AuthMethodType,
    AuthMethodScope,
} from "@lit-protocol/constants";
import {
    LitActionResource,
    createSiweMessageWithRecaps,
    generateAuthSig,
    LitPKPResource,
} from "@lit-protocol/auth-helpers";
import { LitAbility } from "@lit-protocol/types";
import { ipfsHelpers } from "ipfs-helpers";
import { pkpPermissionAddress, pkpPermissionAbi } from "./config";


const litNodeClient = new LitNodeClient({
    alertWhenUnauthorized: false,
    litNetwork: "datil-dev",
    debug: true,
    rpcUrl: `https://vesuvius-rpc.litprotocol.com`,
});

const litAuthClient = new LitAuthClient({
    litRelayConfig: {
    //   relayUrl: "https://datil-dev-relayer.getlit.dev",
      relayApiKey: "r46thg1w-l9r4-s2na-9j5c-ikg5v2sfv2p8_anshtest",
    },
    litNodeClient,
    debug: true,
  });


export let newlyMintedPKP = {
    ethAddress: "0x9282636CFbB38424af70e6337Ee2E31f3e8B9f72",
    publicKey: "0426f8541a9950fcaada70daac9ca34d958d7a91265057686d08e8240f7c5bc649123e1cb3f10f04df7112566a620592ed2ec0d7a41d04bc1abcb18fc26018a157",
    tokenId: "0xdae425bb04422e37374dcd1fe41a92a2ad812aa23d4da6d677c666c6d3a33dbf",
};
let newlyCapacityTokenId = "";
let newlyIpfsHash = "";
let newlySessionSig = "";


export async function createSession() {

    await litNodeClient.connect();

    const litActionCode = `
    const go = async () => {
    // The params toSign, publicKey, sigName are passed from the jsParams fields and are available here
    const sigShare = await Lit.Actions.signEcdsa({ toSign, publicKey, sigName });
    };

    go();
    `;
    
    const litActionSessionSigs = await litNodeClient.getLitActionSessionSigs({
        pkpPublicKey: newlyMintedPKP.publicKey,
        resourceAbilityRequests: [
          { 
            resource: new LitPKPResource("*"), 
            ability: LitAbility.PKPSigning 
        },
          {
            resource: new LitActionResource("*"),
            ability: LitAbility.LitActionExecution,
          },
        ],
        litActionCode: Buffer.from(litActionCode).toString("base64"),
        jsParams: {
            toSign: [
                84, 104, 105, 115, 32, 109, 101, 115, 115, 97, 103, 101, 32,
                105, 115, 32, 101, 120, 97, 99, 116, 108, 121, 32, 51, 50, 32,
                98, 121, 116, 101, 115,
            ],
            publicKey: newlyMintedPKP.publicKey,
            sigName: "sig1",
        },
      });

      newlySessionSig = litActionSessionSigs

      console.log(newlySessionSig)
}


// authorize with eth wallet for a session duration
export async function createSessionWithEthWallet() {
    console.log("clicked");
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    await litNodeClient.connect();

    const sessionSigs = await litNodeClient.getSessionSigs({
        chain: "ethereum",
        expiration: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
        resourceAbilityRequests: [
            {
                resource: new LitActionResource("*"),
                ability: LitAbility.LitActionExecution,
            },
        ],
        authNeededCallback: async ({
            resourceAbilityRequests,
            expiration,
            // uri,
        }) => {
            const toSign = await createSiweMessageWithRecaps({
                uri: "http://localhost:3000",
                expiration,
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

    newlySessionSig = sessionSigs;
    console.log("sessionSigs: ", sessionSigs);
}


async function authenticateWithEthereum() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();
    const address = await provider.send("eth_requestAccounts", []);

    const messageToSign = async (message) => {
        const sig = await ethersSigner.signMessage(message);
        return sig;
    };

    const authSig = {
        sig: ethersSigner,
        derivedVia: "web3.eth.personal.sign",
        signedMessage: messageToSign(),
        address: address[0],
    };

    const authMethod = {
        authMethodType: AuthMethodType.EthWallet,
        accessToken: stringify(authSig), // using stringify to convert circular json object to string
    };
    
    return authMethod;
}



export async function mintPKP() {
    console.log("clicked");
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const authMethod = await authenticateWithEthereum();

    const contractClient = new LitContracts({
        signer: ethersSigner,
        network: "datil-dev",
    });

    await contractClient.connect();

    const mintInfo = await contractClient.mintWithAuth({
        authMethod: authMethod,
        scopes: [
            // AuthMethodScope.NoPermissions,
            AuthMethodScope.SignAnything,
            // AuthMethodScope.PersonalSign,
        ],
        authMethodId: 1, // for eth wallet
    });
    console.log(mintInfo);
    newlyMintedPKP = mintInfo.pkp;
    console.log("newly minted: ", newlyMintedPKP);

    const authId = await LitAuthClient.getAuthIdByAuthMethod(authMethod);

    const scopes =
        await contractClient.pkpPermissionsContract.read.getPermittedAuthMethodScopes(
            newlyMintedPKP.tokenId,
            AuthMethodType.EthWallet,
            authId,
            3 // max scope id
        );

    const noPermissionsScope = scopes[0];
    const signAnythingScope = scopes[1];
    const personalSignScope = scopes[2];

    console.log({
        noPermissionsScope: noPermissionsScope,
        signAnythingScope: signAnythingScope,
        personalSignScope: personalSignScope,
    });
}


const redirectUri = "http://localhost:3000";

export async function authenticateWithGoogle() {
    litAuthClient.initProvider(ProviderType.Google, {
        redirectUri: redirectUri,
    });

    const provider = litAuthClient.getProvider(
        ProviderType.Google
      );

      console.log("provider", provider);
    await provider.signIn();
}

export async function getGoogleAuthMethod() {
    console.log("clicked");
    if (isSignInRedirect(redirectUri)) {
        
        console.log("isSignInRedirect");

        litAuthClient.initProvider(ProviderType.Google, {
            redirectUri: redirectUri,
        });

      const provider = litAuthClient.getProvider(
        ProviderType.Google,
      );

      // Get auth method object that has the OAuth token from redirect callback
      const authMethod = await provider.authenticate();
      console.log(authMethod);
      return authMethod;
    }
  }



export async function fetchMintedPKPs() {
    litAuthClient.initProvider(ProviderType.EthWallet);
    const provider = litAuthClient.getProvider(ProviderType.EthWallet);
    // const test = litAuthClient.getProvider(ProviderType.EthWallet);
    const authMethod = await provider.authenticate({
        domain: "localhost",
        origin: "http://localhost:3000",
    });
    const allPKPs = await provider.fetchPKPsThroughRelayer(authMethod);
    // test.
    
    console.log(allPKPs)
    // console.log(allPKPs);
}


function getWalletWithCapacityNFT() {
    // const provider = new ethers.providers.JsonRpcProvider(
    //     `https://vesuvius-rpc.litprotocol.com`
    // );
    // const walletWithCapacityCredit = new Wallet(
    //     // wallet for application, this will mint itself nft, must have lit tokens
    //     "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352",
    //     provider
    // );

    // return walletWithCapacityCredit;

    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();
    return ethersSigner;
}





export async function mintCapacityCreditsNFT() {
    // const walletWithCapacityCredit = getWalletWithCapacityNFT();
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const contractClient = new LitContracts({
        signer: ethersSigner,
        network: "datil-dev",
    });

    await contractClient.connect();

    const { capacityTokenIdStr } = await contractClient.mintCapacityCreditsNFT(
        {
            requestsPerKilosecond: 80,
            // requestsPerDay: 14400,
            // requestsPerSecond: 10,
            daysUntilUTCMidnightExpiration: 2,
        },
        { gasPrice: ethers.utils.parseUnits("0.001", "gwei"), gasLimit: 400000 }
    );
    newlyCapacityTokenId = capacityTokenIdStr;
    console.log("capacityTokenId: ", newlyCapacityTokenId);
}


export async function delegateCapacityCreditsNFT() {
    // const walletWithCapacityCredit = getWalletWithCapacityNFT();
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const { capacityDelegationAuthSig } =
        await litNodeClient.createCapacityDelegationAuthSig({
            dAppOwnerWallet: ethersSigner,
            capacityTokenId: newlyCapacityTokenId,
            delegateeAddresses: [newlyMintedPKP.ethAddress],
            uses: "1",
        });

    console.log("delegation completed: ", capacityDelegationAuthSig);
}


// await googleProvider.signIn();

// import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";

// async function ethersPKPWallet() {
//     const pkpEthersWallet = new PKPEthersWallet({
//         controllerSessionSigs,
//         litNodeClient,
//         pkpPubKey,
//       });
//       await pkpEthersWallet.init();
// }


export async function addAuthMethod() {
    // const wallet = getWalletWithCapacityNFT();
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const ethersSigner = provider.getSigner();

    const litContracts = new LitContracts({
        signer: ethersSigner, // pkp wallet of the owner of the pkp NFT
    });
    await litContracts.connect();

    const authMethodGoogle = await getGoogleAuthMethod();

    const transaction =
        await litContracts.pkpPermissionsContract.write.addPermittedAuthMethod(
            newlyMintedPKP.tokenId,
            authMethodGoogle,
            [ethers.BigNumber.from(1)], // 1 is the permission for arbitrary signing (scope)
            { gasPrice: ethers.utils.parseUnits("0.001", "gwei"), gasLimit: 400000 }
        );
    const result = await transaction.wait();

    console.log(result);
}


async function talkWithPKPpermissionsContract() {
    const provider = new ethers.providers.JsonRpcProvider(
        `https://vesuvius-rpc.litprotocol.com`
    );
    const contract = new ethers.Contract(
        pkpPermissionAddress,
        pkpPermissionAbi,
        provider
    );
    // 0x62df1070b1d663d86fb0795f5d0e3e73a302b717b9d27cfce4172c0c104ce982
    const data = await contract.getPermittedAuthMethods(newlyMintedPKP.tokenId);
    return data;
}


export async function seeAuthMethods() {
    console.log("clicked");

    // const data = await talkWithPKPpermissionsContract()
    // console.log(data);

    const wallet = getWalletWithCapacityNFT();

    const litContracts = new LitContracts({
        signer: wallet,
        network: "datil-dev",
    });
    await litContracts.connect();

    const authMethods =
        await litContracts.pkpPermissionsContract.read.getPermittedAuthMethods(
            "0x62df1070b1d663d86fb0795f5d0e3e73a302b717b9d27cfce4172c0c104ce982"
        );

    console.log(authMethods);
}



export async function uploadLitActionToIPFS() {
    const litActionCode = `
    const go = async () => {
    // The params toSign, publicKey, sigName are passed from the jsParams fields and are available here
    const sigShare = await Lit.Actions.signEcdsa({ toSign, publicKey, sigName });
    };

    go();
    `;

    const ipfsHash = await ipfsHelpers.stringToCidV0(litActionCode);

    newlyIpfsHash = ipfsHash;

    console.log("ipfsHash: ", ipfsHash);
}

    // ipfsId: newlyIpfsHash,
    // responseStrategy: 'common',
    
export async function executeLitAction() {
    console.log("clicked");

    const litActionCode = `
    const go = async () => {
        const sigShare = await Lit.Actions.signEcdsa({ toSign, publicKey, sigName });
    };

    go();
    `;

    await litNodeClient.connect();

    const authMethod = await authenticateWithEthereum();

    const signatures = await litNodeClient.executeJs({
        code: litActionCode,
        sessionSigs: newlySessionSig,
        authMethods: authMethod,
        jsParams: {
            toSign: [
                84, 104, 105, 115, 32, 109, 101, 115, 115, 97, 103, 101, 32,
                105, 115, 32, 101, 120, 97, 99, 116, 108, 121, 32, 51, 50, 32,
                98, 121, 116, 101, 115,
            ],
            publicKey: newlyMintedPKP.publicKey,
            sigName: "sig1",
        },
    });

    console.log("signatures: ", signatures);
}

// const signEcdsa = async () => {
//     // this Lit Action simply requests an ECDSA signature share from the Lit Node
//     const message = new Uint8Array(
//       await crypto.subtle.digest('SHA-256', new TextEncoder().encode('Hello world'))
//     );
//     const resp = await Lit.Actions.call({
//       ipfsId: "QmRwN9GKHvCn4Vk7biqtr6adjXMs7PzzYPCzNCRjPFiDjm",
//       params: {
//         // this is the string "Hello World" for testing
//         toSign: message,
//         publicKey:
//           "0x02e5896d70c1bc4b4844458748fe0f936c7919d7968341e391fb6d82c258192e64",
//         sigName: "childSig",
//       },
//     });
  
//     console.log("results: ", resp);
//   };