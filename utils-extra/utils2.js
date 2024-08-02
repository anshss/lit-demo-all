import { LitNodeClient } from "@lit-protocol/lit-node-client";
import {
    LitActionResource,
    createSiweMessageWithRecaps,
    generateAuthSig,
} from "@lit-protocol/auth-helpers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { ethers } from "ethers";
import { LitAbility } from "@lit-protocol/types";
import { LitAuthClient } from "@lit-protocol/lit-auth-client";
import {
    ProviderType,
    AuthMethodType,
    AuthMethodScope,
} from "@lit-protocol/constants";
import { stringify } from "flatted";
import { Wallet } from "ethers";

// client initialization
const litNodeClient = new LitNodeClient({
    alertWhenUnauthorized: false,
    litNetwork: "habanero",
    debug: true,
});

const relayUrl = process.env.REACT_APP_RELAY_URL;

const litAuthClient = new LitAuthClient({
    litRelayConfig: {
        relayApiKey: relayUrl,
    },
    litNodeClient,
    debug: true,
});
// // variables
// const redirectUri = "http://localhost:3000/new";
// const DOMAIN = "localhost";
// const ORIGIN = "http://localhost:3000";

// // auth google
// async function signInWithGoogle() {
//     const googleProvider = litAuthClient.initProvider(ProviderType.Google, {
//         redirectUri,
//     });
//     await googleProvider.signIn();
// }

// async function authenticateWithGoogle() {
//     const googleProvider = litAuthClient.initProvider(ProviderType.Google, {
//         redirectUri,
//     });
//     const authMethod = await googleProvider.authenticate();
//     return authMethod;
// }

// // auth eth wallet
// export async function authenticateWithEthWallet(address, signMessage) {
//     const ethWalletProvider = litAuthClient.initProvider(
//         ProviderType.EthWallet,
//         {
//             domain: DOMAIN,
//             origin: ORIGIN,
//         }
//     );
//     const authMethod = await ethWalletProvider.authenticate({
//         address,
//         signMessage,
//     });
//     return authMethod;
// }

// // get session sigs
// export async function getSessionSigs({
//     pkpPublicKey,
//     authMethod,
//     sessionSigsParams,
// }) {
//     const provider = getProviderByAuthMethod(authMethod);
//     const sessionSigs = await provider.getSessionSigs({
//         pkpPublicKey,
//         authMethod,
//         sessionSigsParams,
//     });
//     return sessionSigs;
// }

// get eth wallet auth and session sigs
async function authEthWalletAndSessionSign() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const address = await provider.send("eth_requestAccounts", []);
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
            uri,
        }) => {
            const toSign = await createSiweMessageWithRecaps({
                uri,
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
    console.log(sessionSigs);
}

// // fetch pkps
// export async function getPKPs() {
//     // const authMethod = AuthMethodType.EthWallet
//     const provider = litAuthClient.getProvider(ProviderType.EthWallet);
//     const allPKPs = await provider.fetchPKPsThroughRelayer(authMethod);
//     console.log(allPKPs)
//     // return allPKPs;
// }

async function mintPKP() {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const address = await provider.send("eth_requestAccounts", []);
    const ethersSigner = provider.getSigner()   ;

    const messageToSign = async (message) => {
        const sig = await ethersSigner.signMessage(message);
        return sig;
    };

    const authSig = {
        sig: ethersSigner,
        derivedVia: "web3.eth.personal.sign",
        signedMessage: messageToSign,
        address: address,
    };

    const authMethod = {
        authMethodType: AuthMethodType.EthWallet,
        // using stringify to convert circular json object to string
        accessToken: stringify(authSig),
    };

    const contractClient = new LitContracts({
        signer: ethersSigner,
        network: "habanero",
    });

    await contractClient.connect();

    const mintInfo = await contractClient.mintWithAuth({
        authMethod: authMethod,
        scopes: [
            // AuthMethodScope.NoPermissions,
            // AuthMethodScope.SignAnything,
            AuthMethodScope.PersonalSign,
        ],
        authMethodId: 1, // for eth wallet
    });
    console.log(mintInfo);

    const authId = await LitAuthClient.getAuthIdByAuthMethod(authMethod);
    const scopes =
        await contractClient.pkpPermissionsContract.read.getPermittedAuthMethodScopes(
            mintInfo.pkp.tokenId,
            AuthMethodType.EthWallet,
            authId,
            3
        );

    const signAnythingScope = scopes[1];
    const personalSignScope = scopes[2];
    console.log({
        signAnythingScope: signAnythingScope,
        personalSignScope: personalSignScope,
    });
}

export async function releaseCapacityCredits() {
    // wallet for application, this will mint capacity credit nft
    const walletWithCapacityCredit = new Wallet(
        "d653763be1854048e1a70dd9fc94d47c09c790fb1530a01ee65257b0b698c352"
    );

    let contractClient = new LitContracts({
        signer: walletWithCapacityCredit,
        network: "habanero",
    });

    await contractClient.connect();

    console.log("connected");   

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
            delegateeAddresses: [secondWalletPKPInfo.ethAddress],
        });
}

// get Provider
async function getProviderByAuthMethod(authMethod) {
    if (authMethod == AuthMethodType.GoogleJwt) {
        return litAuthClient.getProvider(ProviderType.Google);
    } else if (authMethod == AuthMethodType.EthWallet) {
        return litAuthClient.getProvider(ProviderType.EthWallet);
    }
    return undefined;
}

// inference calls
export async function authGmail() {
    console.log("started");
    await signInWithGoogle();
    console.log("authenticated");
}

export async function authEthWallet() {
    console.log("started");
    await authEthWalletAndSessionSign();
    console.log("authenticated");
}

export async function mintPKPCall() {
    console.log("started");
    const authMethod = AuthMethodType.EthWallet;
    await mintPKP(authMethod);
}





export async function getCapacityCredits() {
    const provider = new ethers.providers.JsonRpcProvider(`https://chain-rpc.litprotocol.com/replica-http`)

    const walletWithCapacityCredit = new Wallet(
        "<private key>",
        provider
    );

    let contractClient = new LitContracts({
        signer: walletWithCapacityCredit,
        network: "habanero",
    });

    await contractClient.connect();

    console.log("connected");

    const { capacityTokenIdStr } = await contractClient.mintCapacityCreditsNFT({
        requestsPerKilosecond: 80,
        requestsPerDay: 14400,
        requestsPerSecond: 10,
        daysUntilUTCMidnightExpiration: 2,
    });

    console.log("minted");
}