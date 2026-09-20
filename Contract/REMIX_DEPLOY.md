# TicketPro Polygon 배포

MetaMask 개인키나 시드 문구를 다른 사람 또는 서버에 제공하지 않는다.

## Remix 설정

1. Remix에서 `TicketPro.sol`을 생성하고 제공된 소스를 붙여 넣는다.
   소스의 import는 Solidity 0.8.24와 검증한 OpenZeppelin Contracts `5.0.2`로 고정되어 있다.
2. Solidity Compiler에서 컴파일러를 `0.8.24`로 선택한다.
3. Optimization을 켜고 Runs를 `200`으로 설정해 컴파일한다.
4. Deploy & Run Transactions에서 Environment를 `Injected Provider - MetaMask`로 선택한다.
5. MetaMask 네트워크가 Polygon Mainnet인지 확인한다. Chain ID는 `137`이다.
6. 배포 컨트랙트로 `TicketPro`를 선택한다.

## 생성자 인자

현재 주소를 그대로 사용할 경우 두 인자 모두 다음 주소다.

```text
initialOwner:    0xA0078D69851CeD9B8715d2276ceDcAB97481827f
initialOperator: 0xA0078D69851CeD9B8715d2276ceDcAB97481827f
```

보안을 강화하려면 `initialOwner`에는 서버에 저장되지 않은 별도 MetaMask 주소를 사용하고,
`initialOperator`에만 위 서버 운영 주소를 사용한다.

`Deploy`를 누르면 MetaMask가 예상 가스비와 함께 최종 승인을 요청한다. 승인 후 생성된
컨트랙트 주소와 배포 트랜잭션 해시를 기록한다. 개인키나 시드 문구는 기록하거나 전달하지 않는다.

## 배포 전 분석

1. 먼저 Solidity Compiler에서 `TicketPro.sol`을 컴파일한다.
2. Plugin Manager에서 `Solidity Analyzers`를 활성화한다.
3. Remix Analysis와 Solhint를 선택해 분석한다.
4. Remix 계정 로그인 후 오른쪽 RemixAI Assistant에서 `/audit`을 실행한다.
5. AI 결과만 믿지 말고 컴파일 오류, 정적 분석 결과, 생성자 주소와 Polygon Chain ID를 직접 확인한다.
